# Lyrics Fetcher Telegram Bot

This project is a Telegram bot that allows users to search for song lyrics via the [Genius API](https://genius.com). The bot is built using [Telegraf](https://telegraf.js.org/), a framework for building Telegram bots, and it is deployed using Express as a webhook server.

## Features

-   Search for songs by title using the Genius API.
-   Fetch and display lyrics for the selected song.
-   Paginate song search results for easier navigation.
-   Handles text commands and logs bot interactions using `winston`.
-   Provides song thumbnails along with lyrics when available.

## Prerequisites

Before you can run the bot, make sure you have the following:

-   **Node.js** (version 16 or later)
-   **Telegram Bot Token**: You can obtain this by creating a bot via [BotFather](https://t.me/BotFather) on Telegram.
-   **Genius API Token**: Sign up at [Genius API](https://genius.com/api-clients) to get access to their song database.
-   **Express** and **Telegraf** npm packages installed.

## Installation

1. Clone the repository:

    ```bash
    git clone https://github.com/sanoy24/genius-telegram-bot .git
    cd telegram-lyrics-bot
    ```

2. Install the dependencies:

    ```bash
    npm install
    ```

3. Set up environment variables:

    Create a `.env` file in the root directory and add the following:

    ```
    TELEGRAM_BOT_TOKEN=your-telegram-bot-token
    GENIUS_API_TOKEN=your-genius-api-token
    ```

4. (Optional) You can use the webhook URL in the:

    ```javascript
    const WEBHOOK_URL = "https://your-domain.com/api/bot/webhook";
    ```

5. Run the bot:

    ```bash
    npm start
    ```

    The bot will be listening on the port specified by `process.env.PORT` or `3000` by default.

## How to Use

1. **Start the bot**: Users can initiate the bot by typing `/start`.
2. **Search for songs**: Send any song title to the bot, and it will display a paginated list of matching songs from Genius.
3. **Select a song**: Choose a song from the list, and the bot will fetch and display the lyrics. The bot will also send a thumbnail image of the song if available.

## Bot Commands

-   `/start`: Initiates the bot and clears any previous song selections.
-   **Search for a song**: Just type the song's title, and the bot will display matching results.

## Logging

The bot logs all events (start commands, song searches, errors, etc.) using `winston`. Logs are stored in a file called `bot-actions.log`.

## Deployment

You can deploy the bot to platforms like Vercel, Heroku, or any cloud provider that supports Node.js. Make sure the webhook URL is correctly set up according to your deployment.

### Example Deployment on Vercel:

1. Create a project on [Vercel](https://vercel.com).
2. Deploy the project using the Vercel CLI or through the Vercel dashboard.
3. After deployment, set the `TELEGRAM_BOT_TOKEN` and `GENIUS_API_TOKEN` as environment variables on Vercel.
4. Set the Telegram bot webhook URL to the deployed Vercel URL, e.g.,:

    ```bash
    https://your-vercel-app.vercel.app/api/bot/webhook
    ```

## File Structure

```
.
├── bot.js                 # Main bot logic
├── fetch_lyrics.js        # Module for fetching and formatting lyrics
├── bot-actions.log        # Log file for bot events
├── README.md              # This file
└── .env                   # Environment variables (not included in the repo)
```

## License

This project is licensed under the MIT License. See the [LICENSE](https://opensource.org/license/mit) file for details.

## Contact

For any questions or issues, feel free to contact me at [Sanoy](myonas86@gmail.com).
