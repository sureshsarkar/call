const mongoose = require('mongoose');
const config = require('./env');

async function connectDB() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
  console.log(`[db] connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
}

module.exports = connectDB;
