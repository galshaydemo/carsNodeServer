const bcrypt = require('bcryptjs');
const supabase = require('./supabase');

const drivers = [
  { name: 'Driver 1', username: 'driver1', password: 'password1' },
  { name: 'Driver 2', username: 'driver2', password: 'password2' },
  { name: 'Driver 3', username: 'driver3', password: 'password3' },
  { name: 'Driver 4', username: 'driver4', password: 'password4' },
];

const cars = [
  { name: 'Car A', plate: '111-11-111', current_km: 50000, last_service_km: 45000 },
  { name: 'Car B', plate: '222-22-222', current_km: 80000, last_service_km: 75000 },
];

async function main() {
  const userRows = drivers.map((d) => ({
    name: d.name,
    username: d.username,
    password_hash: bcrypt.hashSync(d.password, 10),
  }));
  const { error: userError } = await supabase
    .from('users')
    .upsert(userRows, { onConflict: 'username', ignoreDuplicates: true });
  if (userError) throw userError;

  const { count, error: countError } = await supabase
    .from('cars')
    .select('*', { count: 'exact', head: true });
  if (countError) throw countError;

  if (count === 0) {
    const carRows = cars.map((c) => ({
      ...c,
      last_service_date: new Date().toISOString().slice(0, 10),
    }));
    const { error: carError } = await supabase.from('cars').insert(carRows);
    if (carError) throw carError;
  }

  console.log('Seed complete. Drivers:');
  drivers.forEach((d) => console.log(`  ${d.username} / ${d.password}`));
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
