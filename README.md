# Telegram Channel Forwarder

A NestJS-based Telegram bot that forwards messages from multiple source channels to target channels or topics with simple text replacement.

## Features

- ✅ Forward messages from multiple source channels
- ✅ Route to different target channels or specific topics within groups
- ✅ Simple text replacement (@pass1fybot → @cheapmirror)
- ✅ Support for text, images, videos, documents, and albums
- ✅ **Inline keyboard buttons/links preservation** - Automatically includes buttons from original posts
- ✅ **Case-insensitive keyword search** - Filter messages by keywords (matches "Gate", "GATE", "gate", "GateIO", etc.)
- ✅ Message edit synchronization
- ✅ Reply chain preservation
- ✅ Legacy single-channel mode support

## Recent Changes (v2.0)

### What's New

- **Removed OpenAI Dependency**: No longer requires OpenAI API key or translation service
- **Simple Text Replacement**: Replaces `@pass1fybot` with `@cheapmirror` in all messages
- **Multi-Channel Routing**: Route messages from multiple source channels to different target channels
- **Flexible Topic Support**: Post to specific topics in groups OR regular channels

### Breaking Changes

- OpenAI translation has been removed
- `prompts.json` is no longer used
- Configuration format has changed for multi-channel mode

## Installation

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your configuration
nano .env
```

## Configuration

### Environment Variables

Edit your `.env` file with the following:

```bash
# Telegram API Credentials (Required)
# Get from https://my.telegram.org/apps
TELEGRAM_API_ID=your_api_id
TELEGRAM_API_HASH=your_api_hash
TELEGRAM_PHONE=+1234567890

# Session name for persistent login
SESSION_NAME=telegram_translator

# Multi-Channel Configuration (see examples below)
CHANNELS_CONFIG=sourceId:targetChannelId:topicId,sourceId:targetChannelId:topicId,...
```

### Channel Configuration Examples

#### Example 1: Multiple sources → One group with topics

10 source channels posting to Topic 2, and 2 source channels posting to a regular channel:

```bash
CHANNELS_CONFIG=-1001234567890:-1002995160061:2,-1009876543210:-1002995160061:2,-1005555555555:-1002995160061:2,-1001111111111:-1002995160061:2,-1002222222222:-1002995160061:2,-1003333333333:-1002995160061:2,-1004444444444:-1002995160061:2,-1005555555556:-1002995160061:2,-1006666666666:-1002995160061:2,-1007777777777:-1002995160061:2,-1008888888888:-1001999999999,-1009999999999:-1001999999999
```

#### Example 2: Mixed routing

Some to topics, some to regular channels:

```bash
CHANNELS_CONFIG=-1001111111111:-1002995160061:5,-1002222222222:-1003456789012
```

This routes:

- Channel `-1001111111111` → Group `-1002995160061`, Topic `5`
- Channel `-1002222222222` → Regular channel `-1003456789012`

### Getting Channel and Topic IDs

#### Get Channel ID:

1. Forward a message from the channel to [@userinfobot](https://t.me/userinfobot)
2. It will show the channel ID:
   - Regular channels/groups: `-1001234567890` (negative number)
   - Bot channels: `8432698818` (positive number, no minus sign)

**Note**: Bot channels work exactly the same way as regular channels, just use their positive ID in the configuration. For example:

```bash
CHANNELS_CONFIG=8432698818:-1002995160061:2,123456789:-1002995160061:5
```

#### Get Topic ID:

1. Open the topic in Telegram Desktop or Web
2. Look at the URL: `https://web.telegram.org/a/#-1002995160061_5`
3. The number after the underscore is the topic ID (in this case: `5`)

### Configuration Format Details

```
CHANNELS_CONFIG=sourceId:targetChannelId:topicId,sourceId:targetChannelId:topicId,...
```

- **sourceId**: Channel ID to listen to (source)
- **targetChannelId**: Channel ID to post to (destination)
- **topicId**: _(Optional)_ Topic ID if posting to a group with topics. Omit for regular channels.

### Legacy Single-Channel Mode

Still supported for simple one-to-one forwarding:

```bash
SOURCE_CHANNEL_ID=-1001234567890
TARGET_CHANNEL_ID=-1009876543210
```

## Running the Bot

```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

### First Run

On first run, you'll be prompted to:

1. Enter the authentication code sent to your Telegram
2. Enter your 2FA password (if enabled)

The session will be saved for future runs.

## Text Replacement

The bot automatically replaces all occurrences of `@pass1fybot` (case-insensitive) with `@cheapmirror` in:

- Message text
- Album captions
- Edited messages

## Features in Detail

### Message Types Supported

- Text messages
- Photos
- Videos
- Documents
- Audio
- Albums (multiple media)
- Polls
- Stickers

### Message Edit Sync

When a message is edited in the source channel, the bot automatically updates the corresponding message in the target channel.

### Reply Preservation

The bot maintains reply chains by mapping source message IDs to target message IDs.

### Inline Keyboard Buttons/Links

The bot **automatically preserves inline keyboard buttons** (reply markup) from the original messages. This includes:

- URL buttons (links to external websites)
- Callback buttons
- Any other inline keyboard elements

When a message with buttons is forwarded, all buttons are included in the resent post, maintaining the same functionality and links.

### Keyword Search Filtering

The bot supports **case-insensitive keyword filtering** using the `SEARCH_CONFIG` environment variable.

**How it works:**

- When you search for a keyword like `s-Gate`, the bot will match:
  - `GATE` (all uppercase)
  - `gate` (all lowercase)
  - `Gate` (mixed case)
  - `Gate:` (with punctuation)
  - `GateIO` (as part of a word)
  - Any other combination containing "gate"

**Example configuration:**

```bash
SEARCH_CONFIG=s-Gate:-1003316223699:6:-1003540006367
```

This will monitor channel `-1003316223699`, topic `6`, and forward only messages containing the word "gate" (case-insensitive) to channel `-1003540006367`.

**Multiple keywords:**

```bash
SEARCH_CONFIG=s-Gate:-1003316223699:6:-1003540006367,s-urgent:-1002345678901:5:-1003987654321
```

**Note:** `SEARCH_CONFIG` works alongside `CHANNELS_CONFIG`. You can use both - `SEARCH_CONFIG` for keyword filtering and `CHANNELS_CONFIG` for forwarding all messages.

## Project Structure

```
src/
├── telegram/
│   └── telegram.service.ts    # Telegram client wrapper
├── translator/
│   └── translator.service.ts  # Message forwarding logic
├── app.module.ts              # Application module
└── main.ts                    # Application entry point
```

## Troubleshooting

### "Session expired" error

Delete the session and restart the bot to re-authenticate.

### "Cannot find channel"

Make sure:

1. Your bot account has joined the channel
2. The channel ID is correct (includes the minus sign)
3. For private channels, you have access

### Messages not forwarding

Check:

1. Channel IDs are correct
2. Topic IDs are valid (if using topics)
3. Bot has permission to post in target channel
4. Check logs for specific errors

## Development

```bash
# Run in development mode with auto-reload
npm run start:dev

# Run tests
npm run test

# Build for production
npm run build
```

## License

MIT

## Support

For issues or questions, please open an issue on GitHub.
