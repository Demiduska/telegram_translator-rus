# Telegram Translator Service

A NestJS service that automatically translates messages from a Telegram channel to Korean using OpenAI and posts them to another channel.

## Features

- 📱 Watches a private Telegram channel as a user
- 🌐 Translates messages to South Korean language using OpenAI API
- 📤 Posts translated messages to another channel
- 🔄 Real-time message processing
- 📝 Comprehensive logging

## Prerequisites

1. **Node.js** (v16 or higher)
2. **Telegram API credentials** - Get them from [https://my.telegram.org/apps](https://my.telegram.org/apps)
3. **OpenAI API key** - Get it from [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys)
4. **Channel IDs** - You need the numeric IDs of both source and target channels

## Getting Channel IDs

To get channel IDs:

1. Forward a message from the channel to [@userinfobot](https://t.me/userinfobot)
2. The bot will show you the channel ID (it will be a negative number like `-1001234567890`)

## Installation

1. Clone this repository or copy the files

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

4. Edit the `.env` file with your credentials:

```env
# Telegram API credentials - Get from https://my.telegram.org/apps
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_PHONE=+1234567890

# Channel IDs (must be negative numbers for channels)
SOURCE_CHANNEL_ID=-1001234567890
TARGET_CHANNEL_ID=-1009876543210

# OpenAI API Key
OPENAI_API_KEY=sk-your-openai-api-key-here

# Session name for Telegram client
SESSION_NAME=telegram_translator
```

## Running the Service

### Development Mode

```bash
npm start
```

### Production Mode

1. Build the project:

```bash
npm run build
```

2. Run the compiled version:

```bash
npm run start:prod
```

## First Run Authentication

On the first run, you will be prompted to:

1. Enter the verification code sent to your Telegram phone number
2. Enter your 2FA password (if you have one enabled)

After successful authentication, a session string will be saved and displayed in the logs. You can save this session string to avoid re-authentication in the future by setting it in your code or environment.

## How It Works

1. **Telegram Client Connection**: The service connects to Telegram as your user account using GramJS
2. **Message Watching**: It listens for new messages in the source channel
3. **Translation**: When a new message arrives, it sends the text to OpenAI for translation to Korean
4. **Posting**: The translated message is then posted to the target channel

## Project Structure

```
tg/
├── src/
│   ├── telegram/
│   │   └── telegram.service.ts      # Telegram client management
│   ├── openai/
│   │   └── openai.service.ts        # OpenAI translation service
│   ├── translator/
│   │   └── translator.service.ts    # Main translation orchestrator
│   ├── app.module.ts                # NestJS module configuration
│   └── main.ts                      # Application entry point
├── .env.example                     # Environment variables template
├── package.json                     # Dependencies and scripts
├── tsconfig.json                    # TypeScript configuration
└── README.md                        # This file
```

## Services Overview

### TelegramService

- Manages connection to Telegram using GramJS
- Handles authentication
- Provides methods to watch channels and send messages
- Manages session persistence

### OpenAIService

- Integrates with OpenAI API
- Translates text to Korean using GPT-3.5-turbo
- Optimized for translation with low temperature setting

### TranslatorService

- Orchestrates the translation workflow
- Watches for new messages
- Coordinates between Telegram and OpenAI services
- Handles error cases and logging

## Troubleshooting

### Cannot find module 'telegram'

Make sure the `telegram` package is installed:

```bash
npm install telegram
```

### Authentication Issues

- Ensure your phone number is in international format: `+1234567890`
- Check that your API ID and API Hash are correct
- If you have 2FA enabled, you'll need to enter your password

### Channel Access Issues

- Make sure your account is a member of both channels
- Verify the channel IDs are correct (they should be negative numbers)
- For private channels, ensure you have proper access rights

### Translation Issues

- Verify your OpenAI API key is valid and has credits
- Check the API key has access to the `gpt-3.5-turbo` model
- Review logs for specific error messages

## Notes

- The service runs continuously and will keep watching for new messages
- Messages are translated in real-time as they arrive
- Only text messages are processed (media messages are skipped)
- The service uses your personal Telegram account, not a bot
- Keep your `.env` file secure and never commit it to version control

## Security

- Never share your `.env` file
- Keep your Telegram session string private
- Regularly rotate your OpenAI API key
- Use environment variables for sensitive data

## License

ISC

## Support

For issues related to:

- GramJS: [telegram GitHub](https://github.com/gram-js/gramjs)
- OpenAI API: [OpenAI Documentation](https://platform.openai.com/docs)
- NestJS: [NestJS Documentation](https://docs.nestjs.com)
