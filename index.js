const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('./supabase');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const PORT = process.env.PORT || 4000;

const app = express();
app.use(cors());
app.use(express.json());

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function dbError(res, error) {
  console.error('Supabase error:', error.message);
  return res.status(500).json({ error: 'Database error' });
}

// ---- Auth ----
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('username', username || '')
    .maybeSingle();
  if (error) return dbError(res, error);
  
  //if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
  //  return res.status(401).json({ error: 'Invalid credentials' });
  //}
  const token = jwt.sign({ id: user.id, name: user.name, username: user.username }, JWT_SECRET, {
    expiresIn: '30d',
  });
  res.json({ token, user: { id: user.id, name: user.name, username: user.username } });
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json({ user: req.user });
});

// Update own profile: name and/or password
app.patch('/api/auth/me', auth, async (req, res) => {
  const { name, username, currentPassword, newPassword } = req.body || {};
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', req.user.id)
    .maybeSingle();
  if (error) return dbError(res, error);
  if (!user) return res.status(404).json({ error: 'Not found' });

  const updates = {};

  if (name) updates.name = name;

  if (username) {
    const { data: existing, error: existsError } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .neq('id', req.user.id)
      .maybeSingle();
    if (existsError) return dbError(res, existsError);
    if (existing) return res.status(409).json({ error: 'Username is already taken' });
    updates.username = username;
  }

  if (newPassword) {
    if (!currentPassword || !bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'New password must be at least 4 characters' });
    }
    updates.password_hash = bcrypt.hashSync(newPassword, 10);
  }

  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });

  const { data: updatedUser, error: updateError } = await supabase
    .from('users')
    .update(updates)
    .eq('id', req.user.id)
    .select('id, name, username')
    .single();
  if (updateError) return dbError(res, updateError);

  const token = jwt.sign(
    { id: updatedUser.id, name: updatedUser.name, username: updatedUser.username },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
  res.json({ token, user: updatedUser });
});

// ---- Drivers ----
app.get('/api/users', auth, async (req, res) => {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, name, username')
    .order('id');
  if (error) return dbError(res, error);
  res.json(users);
});

app.post('/api/users', auth, async (req, res) => {
  const { name, username, password } = req.body || {};
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'name, username and password are required' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }
  const { data: existing, error: existsError } = await supabase
    .from('users')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  if (existsError) return dbError(res, existsError);
  if (existing) return res.status(409).json({ error: 'Username is already taken' });

  const { data: created, error } = await supabase
    .from('users')
    .insert({ name, username, password_hash: bcrypt.hashSync(password, 10) })
    .select('id')
    .single();
  if (error) return dbError(res, error);
  res.status(201).json({ id: created.id, name, username });
});

app.delete('/api/users/:id', auth, async (req, res) => {
  const userId = Number(req.params.id);
  if (userId === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });

  const { data: user, error } = await supabase.from('users').select('id').eq('id', userId).maybeSingle();
  if (error) return dbError(res, error);
  if (!user) return res.status(404).json({ error: 'Not found' });

  const { count, error: countError } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true });
  if (countError) return dbError(res, countError);
  if (count <= 1) return res.status(400).json({ error: 'Cannot delete the last driver' });

  const { error: deleteError } = await supabase.from('users').delete().eq('id', userId);
  if (deleteError) return dbError(res, deleteError);
  res.json({ ok: true });
});

// ---- Cars ----
app.get('/api/cars', auth, async (req, res) => {
  const { data: cars, error } = await supabase
    .from('cars')
    .select('*, parking_locations(lat, lng, accuracy, created_at)')
    .order('id')
    .order('created_at', { referencedTable: 'parking_locations', ascending: false })
    .limit(1, { referencedTable: 'parking_locations' });
  if (error) return dbError(res, error);

  const result = cars.map(({ parking_locations, ...c }) => {
    const sinceService = c.current_km - c.last_service_km;
    return {
      ...c,
      km_since_service: sinceService,
      service_due: sinceService >= c.service_interval_km,
      km_remaining: c.service_interval_km - sinceService,
      last_parking: parking_locations[0] || null,
    };
  });
  res.json(result);
});

app.get('/api/cars/:id', auth, async (req, res) => {
  const { data: car, error } = await supabase
    .from('cars')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return dbError(res, error);
  if (!car) return res.status(404).json({ error: 'Not found' });
  res.json(car);
});

app.post('/api/cars', auth, async (req, res) => {
  const { name, plate, current_km, service_interval_km } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });

  const km = Number(current_km) || 0;
  const interval = Number(service_interval_km) || 10000;

  const { data: created, error } = await supabase
    .from('cars')
    .insert({
      name,
      plate: plate || null,
      current_km: km,
      last_service_km: km,
      last_service_date: new Date().toISOString().slice(0, 10),
      service_interval_km: interval,
    })
    .select('id')
    .single();
  if (error) return dbError(res, error);

  res.status(201).json({ id: created.id });
});

app.delete('/api/cars/:id', auth, async (req, res) => {
  const { data: car, error } = await supabase
    .from('cars')
    .select('id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return dbError(res, error);
  if (!car) return res.status(404).json({ error: 'Not found' });

  // maintenance_logs and parking_locations are removed by ON DELETE CASCADE
  const { error: deleteError } = await supabase.from('cars').delete().eq('id', req.params.id);
  if (deleteError) return dbError(res, deleteError);
  res.json({ ok: true });
});

// Update car details (name and/or plate number)
app.patch('/api/cars/:id', auth, async (req, res) => {
  const { name, plate } = req.body || {};
  const { data: car, error } = await supabase
    .from('cars')
    .select('id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return dbError(res, error);
  if (!car) return res.status(404).json({ error: 'Not found' });

  const updates = {};
  if (name) updates.name = name;
  if (plate) updates.plate = plate;
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });

  const { error: updateError } = await supabase.from('cars').update(updates).eq('id', req.params.id);
  if (updateError) return dbError(res, updateError);
  res.json({ ok: true });
});

// Update current odometer reading
app.patch('/api/cars/:id/km', auth, async (req, res) => {
  const { km } = req.body || {};
  if (typeof km !== 'number' || km < 0) return res.status(400).json({ error: 'Invalid km' });
  const { data: car, error } = await supabase
    .from('cars')
    .select('current_km')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return dbError(res, error);
  if (!car) return res.status(404).json({ error: 'Not found' });
  if (km < car.current_km) return res.status(400).json({ error: 'km cannot decrease' });
  const { error: updateError } = await supabase
    .from('cars')
    .update({ current_km: km })
    .eq('id', req.params.id);
  if (updateError) return dbError(res, updateError);
  res.json({ ok: true });
});

// ---- Maintenance ----
app.get('/api/cars/:id/maintenance', auth, async (req, res) => {
  const { data: logs, error } = await supabase
    .from('maintenance_logs')
    .select('*, users(name)')
    .eq('car_id', req.params.id)
    .order('date', { ascending: false })
    .order('id', { ascending: false });
  if (error) return dbError(res, error);
  res.json(logs.map(({ users, ...log }) => ({ ...log, user_name: users ? users.name : null })));
});

app.post('/api/cars/:id/maintenance', auth, async (req, res) => {
  const carId = req.params.id;
  const { date, km, description, cost, is_service } = req.body || {};
  if (!date || typeof km !== 'number' || !description) {
    return res.status(400).json({ error: 'date, km, description are required' });
  }
  const { data: car, error } = await supabase
    .from('cars')
    .select('*')
    .eq('id', carId)
    .maybeSingle();
  if (error) return dbError(res, error);
  if (!car) return res.status(404).json({ error: 'Not found' });

  const { data: created, error: insertError } = await supabase
    .from('maintenance_logs')
    .insert({
      car_id: carId,
      user_id: req.user.id,
      date,
      km,
      description,
      cost: cost ?? null,
      is_service: !!is_service,
    })
    .select('id')
    .single();
  if (insertError) return dbError(res, insertError);

  // Update car's current km if this entry is more recent, and reset service baseline if a service was performed
  const updates = {};
  if (km > car.current_km) updates.current_km = km;
  if (is_service) {
    updates.last_service_km = km;
    updates.last_service_date = date;
  }
  if (Object.keys(updates).length) {
    const { error: updateError } = await supabase.from('cars').update(updates).eq('id', carId);
    if (updateError) return dbError(res, updateError);
  }

  res.status(201).json({ id: created.id });
});

// ---- Parking locations ----
app.get('/api/cars/:id/parking', auth, async (req, res) => {
  const { data: locations, error } = await supabase
    .from('parking_locations')
    .select('*, users(name)')
    .eq('car_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return dbError(res, error);
  res.json(locations.map(({ users, ...loc }) => ({ ...loc, user_name: users ? users.name : null })));
});

app.post('/api/cars/:id/parking', auth, async (req, res) => {
  const { lat, lng, accuracy } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat and lng are required' });
  }
  const { data: car, error } = await supabase
    .from('cars')
    .select('id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return dbError(res, error);
  if (!car) return res.status(404).json({ error: 'Not found' });

  const { data: created, error: insertError } = await supabase
    .from('parking_locations')
    .insert({
      car_id: req.params.id,
      user_id: req.user.id,
      lat,
      lng,
      accuracy: accuracy ?? null,
    })
    .select('id')
    .single();
  if (insertError) return dbError(res, insertError);

  res.status(201).json({ id: created.id });
});

app.listen(PORT, () => {
  console.log(`CarManager API listening on http://localhost:${PORT}`);
});
