require("dotenv").config();
const express = require("express");
const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const fetchlyrics = require("./fetch_lyrics");

const app = express();
const PORT = process.env.PORT || 3000;
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

// Middleware to parse incoming JSON requests
app.use(express.json());

// Set the webhook URL
const webhookUrl = `${process.env.WEBHOOK_URL}webhook`; // Ensure WEBHOOK_URL is set in your environment variables
bot.setWebHook(webhookUrl);

// Map to store song results with page and song information
const songUrlMap = {};
const songsPerPage = 5; // Number of songs per page

// Genius API URL
const geniusApiUrl = "https://api.genius.com/search";

// Handle Telegram messages from users
bot.on("message", async (msg) => {
	const chatId = msg.chat.id;
	const songTitle = msg.text;

	if (songTitle) {
		try {
			// Fetch possible song matches from the Genius API
			const response = await axios.get(geniusApiUrl, {
				headers: { Authorization: `Bearer ${process.env.GENIUS_API_TOKEN}` },
				params: { q: songTitle },
			});
			const hits = response.data.response.hits;

			// Store results and send the first page
			if (hits.length > 0) {
				songUrlMap[chatId] = hits; // Store all hits for this chat
				sendPaginatedSongs(chatId, 0); // Send the first page (page 0)
			} else {
				bot.sendMessage(chatId, `Sorry, I couldn't find any matching songs.`);
			}
		} catch (error) {
			console.error("Error fetching songs", error);
			bot.sendMessage(chatId, `There was an error searching for the song "${songTitle}".`);
		}
	} else {
		bot.sendMessage(chatId, "Please provide a song title.");
	}
});

// Function to send a paginated list of songs
function sendPaginatedSongs(chatId, page) {
	const hits = songUrlMap[chatId];
	const totalPages = Math.ceil(hits.length / songsPerPage);

	// Calculate the start and end indices for the current page
	const start = page * songsPerPage;
	const end = Math.min(start + songsPerPage, hits.length);
	const songsOnPage = hits.slice(start, end);

	// Create inline keyboard options for the current page
	const songOptions = songsOnPage.map((hit, index) => {
		const songId = `song_${start + index}`;
		songUrlMap[songId] = hit.result.url;

		return {
			text: hit.result.full_title,
			callback_data: songId, // Use songId as the callback data
		};
	});

	// Define pagination buttons
	const paginationButtons = [];
	if (page > 0) {
		paginationButtons.push({ text: "Previous", callback_data: `page_${page - 1}` });
	}
	if (page < totalPages - 1) {
		paginationButtons.push({ text: "Next", callback_data: `page_${page + 1}` });
	}

	// Ensure pagination buttons are always sent
	const paginationKeyboard = [];
	if (paginationButtons.length > 0) {
		paginationKeyboard.push(paginationButtons);
	}

	// Send the list of songs with pagination buttons
	bot.sendMessage(chatId, `Please choose a song:`, {
		reply_markup: {
			inline_keyboard: [
				...songOptions.map((option) => [option]),
				...paginationKeyboard, // Ensures pagination buttons appear correctly
			],
		},
	});
}

// Handle callback queries when a user selects a song or navigates pages
bot.on("callback_query", async (callbackQuery) => {
	const chatId = callbackQuery.message.chat.id;
	const callbackData = callbackQuery.data;

	// Acknowledge the callback query to remove the button highlight
	await bot.answerCallbackQuery(callbackQuery.id);

	// If callback data is for pagination (e.g., "page_0", "page_1")
	if (callbackData.startsWith("page_")) {
		const page = parseInt(callbackData.split("_")[1], 10);
		sendPaginatedSongs(chatId, page); // Send the corresponding page
	} else if (callbackData.startsWith("song_")) {
		// If callback data is for a song selection
		const songId = callbackData;
		const songUrl = songUrlMap[songId];

		if (songUrl) {
			try {
				bot.sendMessage(chatId, `Fetching lyrics...`);

				// Fetch the lyrics for the selected song
				const lyrics = await fetchlyrics.fetchLyrics(songUrl);
				const formattedLyrics = fetchlyrics.formatLyrics(lyrics);
				const lyricParts = fetchlyrics.splitMessage(formattedLyrics);

				// Send the lyrics in parts (due to Telegram message size limit)
				for (const part of lyricParts) {
					await bot.sendMessage(chatId, part, { parse_mode: "Markdown" });
				}
			} catch (error) {
				console.error("Error fetching lyrics", error);
				bot.sendMessage(chatId, `There was an error fetching the lyrics for this song.`);
			}
		} else {
			bot.sendMessage(chatId, `Error: Invalid song selection.`);
		}
	}
});

// Handle the webhook updates from Telegram
app.post("/webhook", (req, res) => {
	const update = req.body; // Get the update from the request body
	bot.processUpdate(update); // Process the update using the Telegram bot
	res.sendStatus(200); // Respond with a 200 OK
});

// Starting route for the Express app
app.get("/", async (req, res) => {
	res.send("This is a starting point...");
});

// Start the Express server
app.listen(PORT, () => {
	console.log("App listening on port", PORT);
});
