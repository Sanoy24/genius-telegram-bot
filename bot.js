require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { Telegraf, Markup } = require("telegraf");
const fetchlyrics = require("./fetch_lyrics");
const ytSearch = require("yt-search");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const winston = require("winston");
const path = require("path");
const fs = require("fs");
const youtubeDl = require("youtube-dl-exec");
const sanitize = require("sanitize-filename");
const Redis = require("ioredis");
const redis = new Redis();
const app = express();
const PORT = process.env.PORT || 3000;
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

app.use(express.json());

const logger = winston.createLogger({
	level: "info",
	format: winston.format.json(), // Log in JSON format
	transports: [
		new winston.transports.File({ filename: "bot-actions.log" }), // Log to file
	],
});

const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

// Function to get Spotify Access Token
async function getSpotifyAccessToken() {
	const response = await axios.post("https://accounts.spotify.com/api/token", null, {
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
		},
		params: {
			grant_type: "client_credentials",
		},
	});
	console.log(response.data.access_token);
	return response.data.access_token;
}

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

app.post("/api/bot/webhook", (req, res) => {
	console.log("Webhook received:", req.body);
	bot.handleUpdate(req.body);
	res.sendStatus(200);
});

const songUrlMap = {};
const songsPerPage = 5; // Number of songs per page
const geniusApiUrl = "https://api.genius.com/search";

// start command handler
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

	// Log the text message event
	logger.info({
		event: "text_message",
		user_id: chatId,
		username: username,
		timestamp: new Date().toISOString(),
		message: songTitle,
	});

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

			// Store results in Redis and send the first page
			if (hits.length > 0) {
				await redis.setex(`song_hits:${chatId}`, 2592000, JSON.stringify(hits)); // Expire after 1 month
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
async function sendPaginatedSongs(ctx, page) {
	const chatId = ctx.chat.id;
	const messageId = ctx.update.callback_query
		? ctx.update.callback_query.message.message_id
		: null;

	// Retrieve song hits from Redis
	const hits = JSON.parse(await redis.get(`song_hits:${chatId}`));
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
		const songId = `song_${start + index}_${chatId}`;
		redis.setex(
			songId,
			3600,
			JSON.stringify({ url: hit.result.url, thumbnail: hit.result.song_art_image_url }),
		);

		return {
			text: hit.result.full_title,
			callback_data: songId,
		};
	});

	// Create pagination buttons
	const previousButton = {
		text: "Previous",
		callback_data: page > 0 ? `page_${page - 1}` : "disabled",
	};
	const nextButton = {
		text: "Next",
		callback_data: page < totalPages - 1 ? `page_${page + 1}` : "disabled",
	};

	const messageText = `Please choose a song:\nPage ${page + 1} of ${totalPages}`;

	// Edit the existing message or send a new message if necessary
	if (messageId) {
		ctx.telegram.editMessageText(chatId, messageId, null, messageText, {
			reply_markup: {
				inline_keyboard: [
					...songOptions.map((option) => [option]),
					[previousButton, nextButton],
				],
			},
		});
	} else {
		ctx.reply(messageText, {
			reply_markup: {
				inline_keyboard: [
					...songOptions.map((option) => [option]),
					[previousButton, nextButton],
				],
			},
		});
	}
}

// Handle callback actions for pagination
bot.action(/page_\d+/, (ctx) => {
	const callbackData = ctx.match[0]; // Extract the callback data
	const page = parseInt(callbackData.split("_")[1], 10);
	sendPaginatedSongs(ctx, page); // Send the corresponding page
});

// Handle callback actions for song selection
// Handle callback actions for song selection
bot.action(/song_\d+_\d+/, async (ctx) => {
	const songId = ctx.match[0]; // This should match the format "song_{start + index}_{chatId}"
	const songData = JSON.parse(await redis.get(songId));

	if (songData && songData.url) {
		try {
			// Send the "Fetching lyrics..." message and store its reference
			const fetchingMessage = await ctx.reply("Fetching lyrics...");

			// Fetch the lyrics for the selected song
			const lyrics = await fetchlyrics.fetchLyrics(songData.url);
			const formattedLyrics = fetchlyrics.formatLyrics(lyrics);
			const lyricParts = fetchlyrics.splitMessage(formattedLyrics);

			// Send the song's thumbnail if it exists
			if (songData.thumbnail) {
				await ctx.replyWithPhoto(songData.thumbnail, {
					caption: "Here's the song thumbnail!",
				});
			}

			// Send the lyrics in parts
			for (const part of lyricParts) {
				await ctx.reply(part, { parse_mode: "Markdown" });
			}
			ctx.answerCbQuery();

			// Delete the "Fetching lyrics..." message
			await ctx.telegram.deleteMessage(ctx.chat.id, fetchingMessage.message_id);
		} catch (error) {
			// Log error if there is an issue with fetching lyrics
			logger.error({
				event: "lyrics_fetch_error",
				user_id: ctx.chat.id,
				username: ctx.from.username,
				song: songData.url,
				error: error.message,
				timestamp: new Date().toISOString(),
			});
			await ctx.reply("There was an error fetching the lyrics for this song.");
		}
	} else {
		// Error handling for invalid song selection
		logger.warn({
			event: "invalid_song_selection",
			user_id: ctx.chat.id,
			username: ctx.from.username,
			song_id: songId,
			timestamp: new Date().toISOString(),
		});
		await ctx.reply("Error: Invalid song selection.");
	}
});

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

// Action to handle the download request from an inline button

ffmpeg.setFfmpegPath(ffmpegPath); // This will automatically use the ffmpeg binary from ffmpeg-static

const processing = {};
bot.action(/^download_(.+)/, async (ctx) => {
	const userId = ctx.from.id;
	if (processing[userId]) {
		return ctx.reply("You're already processing a request. Please wait.");
	}
	processing[userId] = true;
	const videoId = ctx.match[1];
	const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

	try {
		// Acknowledge the callback query
		await ctx.answerCbQuery();

		// Inform the user that the download is starting
		const processingRequest = await ctx.reply(
			"Processing your request, downloading the audio...",
		);

		// Use youtube-dl-exec to get the video information
		const info = await youtubeDl(youtubeUrl, {
			dumpSingleJson: true,
		});

		// Sanitize the video title and prepare paths
		const videoTitle = sanitize(info.title);
		const opusFilePath = path.resolve(__dirname, `${videoTitle}.opus`); // Downloaded opus file
		const mp3FilePath = path.resolve(__dirname, `${videoTitle}.mp3`); // Final MP3 file

		// Log the file paths for debugging
		console.log("Temporary opus file path:", opusFilePath);
		console.log("MP3 file path:", mp3FilePath);

		// Start downloading the audio using the 'best' format
		console.log(`Downloading audio from URL: ${youtubeUrl}`);
		await youtubeDl(youtubeUrl, {
			extractAudio: true,
			audioFormat: "best", // Use 'best' audio format
			output: opusFilePath, // Save it as .opus
		});

		// Check if the .opus file exists
		if (!fs.existsSync(opusFilePath)) {
			throw new Error(`File not found: ${opusFilePath}`);
		}

		// Convert the .opus file to .mp3 using ffmpeg
		await new Promise((resolve, reject) => {
			ffmpeg(opusFilePath)
				.toFormat("mp3")
				.save(mp3FilePath)
				.on("end", resolve)
				.on("error", reject);
		});

		// Inform the user that the download is complete and the file is being sent
		const completeAudio = await ctx.reply(`Download complete, sending audio: ${videoTitle}...`);

		ctx.telegram.deleteMessage(ctx.chat.id, processingRequest.message_id);
		ctx.telegram.deleteMessage(ctx.chat.id, completeAudio.message_id);
		// Send the mp3 file
		await ctx.replyWithAudio({ source: mp3FilePath });

		// Clean up the temporary files after sending
		fs.unlinkSync(opusFilePath);
		fs.unlinkSync(mp3FilePath);
	} catch (error) {
		console.error("Error during download process:", error);
		ctx.reply("An error occurred while processing your request.");
	} finally {
		delete processing[userId];
	}
});
// Starting route for the Express app
app.get("/", (req, res) => {
	logger.info({ event: "home_visit", message: "Homepage visited." });
	res.send("This is a starting point...");
});

// Command for downloading videos
bot.command("downloadvideo", async (ctx) => {
	const query = ctx.message.text.replace("/downloadvideo", "").trim();
	console.log("Received video download command with query:", query);

	if (!query) {
		return ctx.reply("Please provide a video name or URL. Usage: /downloadvideo <video name>");
	}

	try {
		const searchResult = await ytSearch(query);
		if (!searchResult || searchResult.videos.length === 0) {
			return ctx.reply(
				"No video results found for your search. Please try a different query.",
			);
		}

		const inlineKeyboard = searchResult.videos.slice(0, 10).map((video) => {
			return [Markup.button.callback(video.title, `downloadvideo_${video.videoId}`)];
		});

		console.log("Sending inline keyboard for video selection:", inlineKeyboard);
		await ctx.reply(
			"Please choose a video to download:",
			Markup.inlineKeyboard(inlineKeyboard),
		);
	} catch (error) {
		console.error("Error during video search or reply:", error);
		ctx.reply("An error occurred while processing your request.");
	}
});

// Action to handle video download request from an inline button
// Action to handle video download request from an inline button
bot.action(/^downloadvideo_(.+)/, async (ctx) => {
	const userId = ctx.from.id;

	if (processing[userId]) {
		return ctx.reply("You're already processing a request. Please wait.");
	}
	processing[userId] = true;

	const videoId = ctx.match[1];
	const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

	try {
		// Acknowledge the callback query
		await ctx.answerCbQuery();

		// Inform the user that the video download is starting
		const processingRequest = await ctx.reply(
			"Processing your request, downloading the video...",
		);

		// Use youtube-dl-exec to get the video information and download it
		const videoInfo = await youtubeDl(youtubeUrl, {
			dumpSingleJson: true,
		});

		// Sanitize the video title and prepare paths
		const videoTitle = sanitize(videoInfo.title);
		const videoFilePath = path.resolve(__dirname, `${videoTitle}.mp4`); // Use .mp4 extension

		// Log the file path for debugging
		console.log("Downloading video to path:", videoFilePath);

		// Start downloading the video
		await youtubeDl(youtubeUrl, {
			format: "best", // Use 'best' format for video
			output: videoFilePath, // Save the video as .mp4
		});

		// Check if the .mp4 file exists
		if (!fs.existsSync(videoFilePath)) {
			throw new Error(`Video file not found: ${videoFilePath}`);
		}

		// Inform the user that the download is complete and the file is being sent
		const completeVideoMessage = await ctx.reply(
			`Download complete, sending video file: ${videoTitle}...`,
		);

		ctx.telegram.deleteMessage(ctx.chat.id, processingRequest.message_id);
		ctx.telegram.deleteMessage(ctx.chat.id, completeVideoMessage.message_id);

		// Explicitly send the video as a document
		await ctx.telegram.sendDocument(ctx.chat.id, {
			source: videoFilePath,
			filename: `${videoTitle}.mp4`, // Display it as .mp4 for user convenience
		});

		// Clean up the temporary file after sending
		fs.unlinkSync(videoFilePath);
	} catch (error) {
		console.error("Error during video download process:", error);
		ctx.reply("An error occurred while processing your video request.");
	} finally {
		delete processing[userId];
	}
});

bot.command("trending_music", async (ctx) => {
	try {
		const accessToken = await getSpotifyAccessToken();

		// Fetch trending tracks (Top 50 Global)
		const response = await axios.get(
			"https://api.spotify.com/v1/playlists/37i9dQZEVXbMDoHDwVN2tF",
			{
				headers: {
					Authorization: `Bearer ${accessToken}`,
				},
			},
		);

		const tracks = response.data.tracks.items.slice(0, 10); // Get the top 10 tracks
		let message = "🎵 *Trending Music Charts (Top 10)* 🎵\n\n";

		tracks.forEach((track, index) => {
			message += `${index + 1}. *${track.track.name}* by *${track.track.artists
				.map((artist) => artist.name)
				.join(", ")}*\n`;
			message += `[Listen on Spotify](${track.track.external_urls.spotify})\n\n`;
		});

		ctx.replyWithMarkdown(message);
	} catch (error) {
		console.error("Error fetching trending music:", error);
		ctx.reply("Sorry, I couldn't fetch the trending music right now. Please try again later.");
	}
});

// Start the Express server
app.listen(process.env.PORT || PORT, () => {
	logger.info({
		event: "server_start",
		message: `App listening on port ${process.env.PORT ? process.env.PORT : PORT}`,
	});
});

// bot.launch();
