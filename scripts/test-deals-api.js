const url = 'http://54.91.147.151:8000/api/v1/deals/?page=1&per_page=100&sort_by=Modified_Time&sort_order=desc';

console.log('Fetching:', url);

const response = await fetch(url, {
  headers: { 'Content-Type': 'application/json' },
});

console.log('Status:', response.status, response.statusText);

const data = await response.json();

console.log('Has data array:', !!data?.data);
console.log('Data length:', data?.data?.length || 0);
console.log('Info:', JSON.stringify(data?.info || {}, null, 2));

if (data?.data?.length > 0) {
  console.log('First item keys:', Object.keys(data.data[0]).join(', '));
  console.log('First item:', JSON.stringify(data.data[0], null, 2));
} else {
  console.log('No data items found');
  console.log('Full response keys:', Object.keys(data));
  console.log('Full response:', JSON.stringify(data, null, 2).slice(0, 2000));
}
