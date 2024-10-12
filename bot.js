require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { Telegraf, Markup } = require("telegraf");
const fetchlyrics = require("./fetch_lyrics");
const ytSearch = require("yt-search");
const ytdl = require("ytdl-core");
const youtubedl = require("youtube-dl-exec");
const ffmpeg = require("ffmpeg");
const winston = require("winston");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const youtubeDl = require("youtube-dl-exec");

const app = express();
const PORT = process.env.PORT || 3000;
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Middleware to parse incoming JSON requests
app.use(express.json());

const logger = winston.createLogger({
	level: "info",
	format: winston.format.json(), // Log in JSON format
	transports: [
		new winston.transports.File({ filename: "bot-actions.log" }), // Log to file
	],
});

// Set the webhook URL
// const webhookUrl = `${process.env.WEBHOOK_URL}/api/bot/webhook`;

// // Set webhook and start bot
// bot.telegram
// 	.setWebhook(webhookUrl)
// 	.then(() => {
// 		console.log(`Webhook set to ${webhookUrl}`);
// 		bot.launch(); // Ensure the bot is launched after setting the webhook
// 	})
// 	.catch((error) => {
// 		console.error(`Failed to set webhook: ${error}`);
// 	});

// app.post("/api/bot/webhook", (req, res) => {
// 	console.log("Webhook received:", req.body); // Log incoming requests
// 	bot.handleUpdate(req.body); // Process the update using Telegraf
// 	res.sendStatus(200); // Respond with a 200 OK
// });

// Map to store song results with page and song information
const songUrlMap = {};
const songsPerPage = 5; // Number of songs per page
const geniusApiUrl = "https://api.genius.com/search";

// /start command handler
bot.start((ctx) => {
	const chatId = ctx.chat.id;
	const username = ctx.from.username;

	// Log the start command
	logger.info({
		event: "start_command",
		user_id: chatId,
		username: username,
		timestamp: new Date().toISOString(),
	});

	// Clear previous state
	delete songUrlMap[chatId];

	// Send welcome message
	ctx.reply("Welcome! Please provide a song title.");
});

// Handle messages from users
bot.command("lyrics", async (ctx) => {
	const chatId = ctx.chat.id;
	const username = ctx.from.username;
	const songTitle = ctx.message.text.replace("/lyrics", "").trim();
	// console.log(songTitle);

	// Log the text message event
	logger.info({
		event: "text_message",
		user_id: chatId,
		username: username,
		timestamp: new Date().toISOString(),
		message: songTitle,
	});

	// if (songTitle.startsWith("/")) {
	// 	return; // Ignore command messages in the generic message handler
	// }

	if (songTitle) {
		try {
			// Fetch possible song matches from the Genius API
			const response = await axios.get(geniusApiUrl, {
				headers: { Authorization: `Bearer ${process.env.GENIUS_API_TOKEN}` },
				params: { q: songTitle },
				json: true,
			});

			const hits = response.data.response.hits;
			logger.info({
				event: "song_search",
				user_id: chatId,
				username: username,
				song: songTitle,
				timestamp: new Date().toISOString(),
			});

			// Store results and send the first page
			if (hits.length > 0) {
				songUrlMap[chatId] = hits; // Store all hits for this chat
				sendPaginatedSongs(ctx, 0); // Send the first page (page 0)
			} else {
				ctx.reply(`Sorry, I couldn't find any matching songs.`);
			}
		} catch (error) {
			logger.error({
				event: "song_search_error",
				user_id: chatId,
				username: username,
				song: songTitle,
				error: error.message,
				timestamp: new Date().toISOString(),
			});
			ctx.reply(`There was an error searching for the song "${songTitle}".`);
		}
	} else {
		ctx.reply("Please provide a song title.");
	}
});

// Function to send a paginated list of songs
function sendPaginatedSongs(ctx, page) {
	const chatId = ctx.chat.id;
	const messageId = ctx.update.callback_query
		? ctx.update.callback_query.message.message_id
		: null;
	const hits = songUrlMap[chatId];
	const songsPerPage = 5; // Adjust this number based on your desired page size
	const totalPages = Math.ceil(hits.length / songsPerPage);

	// Ensure the page number is within bounds
	if (page < 0 || page >= totalPages) {
		return; // Do nothing if the page is out of bounds
	}

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

	// Create pagination buttons
	const previousButton = {
		text: "Previous",
		callback_data: page > 0 ? `page_${page - 1}` : "disabled", // Disable if on the first page
	};
	const nextButton = {
		text: "Next",
		callback_data: page < totalPages - 1 ? `page_${page + 1}` : "disabled", // Disable if on the last page
	};

	const messageText = `Please choose a song:\nPage ${page + 1} of ${totalPages}`;

	// Edit the existing message or send a new message if necessary
	if (messageId) {
		// Edit the existing message with the updated song list and buttons
		ctx.telegram.editMessageText(chatId, messageId, null, messageText, {
			reply_markup: {
				inline_keyboard: [
					...songOptions.map((option) => [option]),
					[previousButton, nextButton], // Always show both buttons
				],
			},
		});
	} else {
		// Send a new message if it's the first time loading the song list
		ctx.reply(messageText, {
			reply_markup: {
				inline_keyboard: [
					...songOptions.map((option) => [option]),
					[previousButton, nextButton], // Always show both buttons
				],
			},
		});
	}
}

// // Handle callback queries
// bot.on("callback_query", async (ctx) => {
// 	const callbackData = ctx.callbackQuery.data;
// 	const chatId = ctx.chat.id;
// 	const username = ctx.from.username;
// 	// console.log("call_back_query", ctx.callbackQuery);

// 	// Log callback event
// 	logger.info({
// 		event: "callback_query",
// 		user_id: chatId,
// 		username: username,
// 		callback_data: callbackData,
// 		song_url: songUrlMap[callbackData],
// 		timestamp: new Date().toISOString(),
// 	});

// 	// Acknowledge the callback query to remove the button highlight
// 	await ctx.answerCbQuery();

// 	if (callbackData.startsWith("page_")) {
// 		const page = parseInt(callbackData.split("_")[1], 10);
// 		sendPaginatedSongs(ctx, page); // Send the corresponding page
// 	} else if (callbackData.startsWith("song_")) {
// 		const songId = callbackData;
// 		// console.log(songUrlMap);
// 		const songData = songUrlMap[songId];

// 		if (songData && songData.url) {
// 			try {
// 				// Send the "Fetching lyrics..." message and store its reference
// 				const fetchingMessage = await ctx.reply("Fetching lyrics...");

// 				// Fetch the lyrics for the selected song
// 				const lyrics = await fetchlyrics.fetchLyrics(songData.url);
// 				const formattedLyrics = fetchlyrics.formatLyrics(lyrics);
// 				const lyricParts = fetchlyrics.splitMessage(formattedLyrics);

// 				// Send the song's thumbnail
// 				if (songData.thumbnail) {
// 					await ctx.replyWithPhoto(songData.thumbnail, {
// 						caption: "Here's the song thumbnail!",
// 					});
// 				}

// 				// Send the lyrics in parts
// 				for (const part of lyricParts) {
// 					await ctx.reply(part, { parse_mode: "Markdown" });
// 				}

// 				// Delete the "Fetching lyrics..." message
// 				await ctx.telegram.deleteMessage(ctx.chat.id, fetchingMessage.message_id);
// 			} catch (error) {
// 				logger.error({
// 					event: "lyrics_fetch_error",
// 					user_id: chatId,
// 					username: username,
// 					song: songData.url,
// 					error: error.message,
// 					timestamp: new Date().toISOString(),
// 				});
// 				await ctx.reply("There was an error fetching the lyrics for this song.");
// 			}
// 		} else {
// 			await ctx.reply("Error: Invalid song selection.");
// 		}
// 	}
// });

// Command to handle song search and inline button creation
bot.command("download", async (ctx) => {
	const query = ctx.message.text.replace("/download", "").trim();
	console.log("Received command with query:", query);

	if (!query) {
		return ctx.reply("Please provide a song name. Usage: /download <song name>");
	}

	try {
		const searchResult = await ytSearch(query);
		if (!searchResult || searchResult.videos.length === 0) {
			return ctx.reply("No results found for your search. Please try a different song name.");
		}

		const inlineKeyboard = searchResult.videos.slice(0, 10).map((video) => {
			return [Markup.button.callback(video.title, `download_${video.videoId}`)];
		});

		console.log("Sending inline keyboard:", inlineKeyboard);
		await ctx.reply("Please choose a song to download:", Markup.inlineKeyboard(inlineKeyboard));
	} catch (error) {
		console.error("Error during search or reply:", error);
		ctx.reply("An error occurred while processing your request.");
	}
});

// General callback handler to see if the bot is receiving any callback queries at all

// More general regex to test if download actions are working

// Bot action for handling song download when an inline button is clicked
// const youtubedl = require('youtube-dl-exec');
// const path = require('path');
// const fs = require('fs');

// Bot action for handling song download when an inline button is clicked
const sanitize = (filename) => {
	return filename.replace(/[<>:"/\\|?*]/g, "_");
};

// Action to handle the download request from an inline button
bot.action(/^download_(.+)/, async (ctx) => {
	const videoId = ctx.match[1];
	const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

	try {
		// Acknowledge the callback query
		await ctx.answerCbQuery();

		// Inform the user that the download is starting
		await ctx.reply("Processing your request, downloading the audio...");

		// Use youtube-dl-exec to get the video information
		const info = await youtubeDl(youtubeUrl, {
			dumpSingleJson: true,
		});

		// Sanitize the video title and prepare paths
		const videoTitle = sanitize(info.title);
		const tempFilePath = path.resolve(__dirname, `${videoTitle}.webm`); // Temporary .webm file
		const audioFilePath = path.resolve(__dirname, `${videoTitle}.mp3`); // Final MP3 file

		// Start downloading the audio
		await youtubeDl(youtubeUrl, {
			extractAudio: true,
			audioFormat: "mp3",
			output: tempFilePath, // Save it temporarily as .webm or .mp3
		});

		// Inform the user that the download is complete and the file is being sent
		await ctx.reply(`Download complete, sending audio: ${videoTitle}...`);

		// Send the audio file
		await ctx.replyWithAudio({ source: tempFilePath });

		// Clean up the temporary file after sending
		fs.unlinkSync(tempFilePath);
	} catch (error) {
		console.error("Error during download process:", error);
		ctx.reply("An error occurred while processing your request.");
	}
});

// Starting route for the Express app
app.get("/", (req, res) => {
	logger.info({ event: "home_visit", message: "Homepage visited." });
	res.send("This is a starting point...");
});

// Start the Express server
app.listen(PORT, () => {
	logger.info({ event: "server_start", message: `App listening on port ${PORT}` });
});

bot.launch();
