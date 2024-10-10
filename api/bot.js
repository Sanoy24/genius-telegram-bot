require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { Telegraf } = require("telegraf");
const fetchlyrics = require("../fetch_lyrics");

const app = express();
const PORT = process.env.PORT || 3000;
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Middleware to parse incoming JSON requests
app.use(express.json());

// Set the webhook URL
const webhookUrl = `https://rnjki-196-188-34-240.a.free.pinggy.link/api/bot/webhook`; // for local test

bot.telegram.setWebhook(webhookUrl);
app.post("/api/bot/webhook", (req, res) => {
	bot.handleUpdate(req.body); // Process the update using Telegraf
	res.sendStatus(200); // Respond with a 200 OK
});

// Call setWebhook when the app starts
const setWebhook = async () => {
	try {
		// Check if the webhook is already set
		const webhookInfo = await bot.telegram.getWebhookInfo();
		console.log(webhookInfo);
		if (webhookInfo.url === webhookUrl) {
			console.log("Webhook is already set.");
			return;
		}

		// If the webhook is not set or needs to be updated, set it
		await bot.telegram.setWebhook(webhookUrl);
		console.log("Webhook set successfully.");
	} catch (error) {
		if (error.response && error.response.error_code === 429) {
			const retryAfter = error.response.parameters.retry_after;
			console.log(`Too many requests. Retrying in ${retryAfter} seconds...`);
			setTimeout(setWebhook, retryAfter * 1000); // Retry after the specified delay
		} else {
			console.error("Error setting webhook:", error);
		}
	}
};

// Map to store song results with page and song information
const songUrlMap = {};
const songsPerPage = 5; // Number of songs per page
const geniusApiUrl = "https://api.genius.com/search";

// /start command handler
bot.start((ctx) => {
	const chatId = ctx.chat.id;

	// Log previous state if applicable
	// console.log(`Previous state for ${chatId}:`, songUrlMap[chatId]);

	// Clear previous state
	delete songUrlMap[chatId];

	// Send welcome message
	ctx.reply("Welcome! Please provide a song title.");
});

// Handle messages from users
bot.on("text", async (ctx) => {
	const chatId = ctx.chat.id;
	const songTitle = ctx.message.text;

	if (songTitle.startsWith("/")) {
		return; // Ignore command messages in the generic message handler
	}

	if (songTitle) {
		try {
			// Fetch possible song matches from the Genius API
			const response = await axios.get(geniusApiUrl, {
				headers: { Authorization: `Bearer ${process.env.GENIUS_API_TOKEN}` },
				params: { q: songTitle },
				json: true,
			});

			const hits = response.data.response.hits;

			// Store results and send the first page
			if (hits.length > 0) {
				songUrlMap[chatId] = hits; // Store all hits for this chat
				// console.log(songUrlMap[chatId]);
				sendPaginatedSongs(ctx, 0); // Send the first page (page 0)
			} else {
				ctx.reply(`Sorry, I couldn't find any matching songs.`);
			}
		} catch (error) {
			// console.error("Error fetching songs", error);
			ctx.reply(`There was an error searching for the song "${songTitle}".`);
		}
	} else {
		ctx.reply("Please provide a song title.");
	}
});

// Function to send a paginated list of songs
function sendPaginatedSongs(ctx, page) {
	const chatId = ctx.chat.id;
	const hits = songUrlMap[chatId];
	const totalPages = Math.ceil(hits.length / songsPerPage);

	// Calculate the start and end indices for the current page
	const start = page * songsPerPage;
	const end = Math.min(start + songsPerPage, hits.length);
	const songsOnPage = hits.slice(start, end);

	// Create inline keyboard options for the current page
	const songOptions = songsOnPage.map((hit, index) => {
		const songId = `song_${start + index}`;
		songUrlMap[songId] = {
			url: hit.result.url, // Store the song URL
			thumbnail: hit.result.song_art_image_url, // Store the song's thumbnail
		};

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

	// Send the list of songs with pagination buttons
	ctx.reply("Please choose a song:", {
		reply_markup: {
			inline_keyboard: [
				...songOptions.map((option) => [option]),
				paginationButtons.length > 0 ? paginationButtons : [], // Ensure pagination buttons appear correctly
			],
		},
	});
}

// Handle callback queries
bot.on("callback_query", async (ctx) => {
	const callbackData = ctx.callbackQuery.data;

	// Acknowledge the callback query to remove the button highlight
	await ctx.answerCbQuery();

	if (callbackData.startsWith("page_")) {
		const page = parseInt(callbackData.split("_")[1], 10);
		sendPaginatedSongs(ctx, page); // Send the corresponding page
	} else if (callbackData.startsWith("song_")) {
		const songId = callbackData;
		const songData = songUrlMap[songId];

		if (songData && songData.url) {
			try {
				// Send the "Fetching lyrics..." message and store its reference
				const fetchingMessage = await ctx.reply("Fetching lyrics...");

				// Fetch the lyrics for the selected song
				const lyrics = await fetchlyrics.fetchLyrics(songData.url);
				const formattedLyrics = fetchlyrics.formatLyrics(lyrics);
				const lyricParts = fetchlyrics.splitMessage(formattedLyrics);

				// Send the song's thumbnail
				if (songData.thumbnail) {
					await ctx.replyWithPhoto(songData.thumbnail, {
						caption: "Here's the song thumbnail!",
					});
				}

				// Send the lyrics in parts
				for (const part of lyricParts) {
					await ctx.reply(part, { parse_mode: "Markdown" });
				}

				// Delete the "Fetching lyrics..." message
				await ctx.telegram.deleteMessage(ctx.chat.id, fetchingMessage.message_id);
			} catch (error) {
				console.error("Error fetching lyrics", error);
				await ctx.reply("There was an error fetching the lyrics for this song.");
			}
		} else {
			await ctx.reply("Error: Invalid song selection.");
		}
	}
});

// Starting route for the Express app
app.get("/", (req, res) => {
	res.send("This is a starting point...");
});

// Start the Express server
app.listen(PORT, () => {
	console.log("App listening on port", PORT);
});

module.exports = app;
