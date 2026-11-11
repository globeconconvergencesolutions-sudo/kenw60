const { createClient } = require('redis');

const REDIS_URL = process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`;

const redisClient = createClient({
  url: REDIS_URL
});

redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

redisClient.on('connect', () => {
  console.log('Connected to Redis server');
});

redisClient.on('ready', () => {
  console.log('Redis client ready');
});

async function connectRedis() {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
  } catch (err) {
    console.error('Could not connect to Redis:', err.message);
  }
}

module.exports = { redisClient, connectRedis };
