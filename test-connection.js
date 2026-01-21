/**
 * Quick connection test script
 * Run with: node test-connection.js
 */

const BASE_URL = 'http://localhost:4000';

const endpoints = [
  { method: 'GET', path: '/health', description: 'Health check' },
  { method: 'GET', path: '/', description: 'API info' },
  { method: 'GET', path: '/data', description: 'List datasets' },
  { method: 'GET', path: '/models', description: 'List models' },
];

async function testConnection() {
  console.log('🧪 Testing backend connection...\n');

  for (const { method, path, description } of endpoints) {
    try {
      const url = `${BASE_URL}${path}`;
      const response = await fetch(url, { method });
      const data = await response.json();

      if (response.ok) {
        console.log(`✅ ${description} (${method} ${path})`);
        console.log(`   Response:`, JSON.stringify(data, null, 2).substring(0, 100) + '...\n');
      } else {
        console.log(`❌ ${description} (${method} ${path}) - Status: ${response.status}\n`);
      }
    } catch (error) {
      console.log(`❌ ${description} (${method} ${path})`);
      console.log(`   Error: ${error.message}\n`);
    }
  }

  console.log('✨ Test complete!');
  console.log('\n💡 If all tests pass, your backend is running correctly.');
  console.log('💡 Check your frontend browser console when navigating to test frontend connection.');
}

testConnection();
