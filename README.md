# Telegram Translator Bot

A NestJS-based Telegram bot that automatically translates messages from one channel to another using OpenAI.

## Features

- Monitors messages from a source Telegram channel
- Translates messages using OpenAI API
- Posts translated messages to a target channel
- Supports text and media messages
- Handles message edits

## Deployment on Railway

### Prerequisites

- GitHub account
- Railway account (sign up at https://railway.app)
- Telegram API credentials
- OpenAI API key

### Deployment Steps

1. **Go to Railway:**

   - Visit https://railway.app
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose the `telegram_translator` repository

2. **Configure Environment Variables:**
   Add the following environment variables in Railway:

   ```
   TELEGRAM_API_ID=your_telegram_api_id
   TELEGRAM_API_HASH=your_telegram_api_hash
   TELEGRAM_PHONE=your_phone_number
   SESSION_NAME=your_session_string
   SOURCE_CHANNEL_ID=source_channel_id
   TARGET_CHANNEL_ID=target_channel_id
   OPENAI_API_KEY=your_openai_api_key
   PORT=3000
   ```

3. **Deploy:**

   - Railway will automatically detect the Node.js project
   - It will run `npm install && npm run build`
   - Then start the app with `npm run start:prod`
   - Your bot will be running 24/7!

4. **Monitor:**
   - Check the logs in Railway dashboard
   - Visit the `/health` endpoint to verify the app is running

## Local Development

1. Clone the repository:

   ```bash
   git clone https://github.com/Demiduska/telegram_translator.git
   cd telegram_translator
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create `.env` file based on `.env.example` and add your credentials

4. Run the application:
   ```bash
   npm run start
   ```

## API Endpoints

- `GET /` - Homepage (service status)
- `GET /health` - Health check endpoint

## Technologies Used

- NestJS
- Telegram MTProto Client
- OpenAI API
- TypeScript
- Express

## License

ISC
