const BASE = (process.env.BACKEND_API_BASE || 'http://54.91.147.151:8000/api/v1').replace(
  /\/+$/,
  ''
);
const url = `${BASE}/deals/?page=1&per_page=5&sort_by=Modified_Time&sort_order=desc`;
console.log('BACKEND_API_BASE:', BASE);
console.log('Fetching:', url);

try {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
  });
  console.log('Status:', response.status, response.statusText);
  
  const text = await response.text();
  console.log('Response length:', text.length);
  
  try {
    const data = JSON.parse(text);
    console.log('Keys:', Object.keys(data));
    console.log('Info:', JSON.stringify(data.info, null, 2));
    
    if (data.data && data.data.length > 0) {
      console.log('First deal keys:', Object.keys(data.data[0]));
      console.log('First deal:', JSON.stringify(data.data[0], null, 2));
    } else {
      console.log('No data array or empty');
      console.log('Full response:', text.substring(0, 2000));
    }
  } catch (e) {
    console.log('Not JSON. Raw response:', text.substring(0, 2000));
  }
} catch (error) {
  console.error('Fetch error:', error.message);
}
