require("dotenv").config();
const express = require("express");
const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const fetchlyrics = require("./fetch_lyrics");

const app = express();
const PORT = process.env.PORT || 3000;
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Genius api url
const geniusApiUrl = "https://api.genius.com/search";

// handle telgram message from telegram users

bot.on("message", async (msg) => {
	const chatId = msg.chat.id;
	const songTitle = msg.text;

	if (songTitle) {
		try {
			const response = await axios.get(geniusApiUrl, {
				headers: { Authorization: `Bearer ${process.env.GENIUS_API_TOKEN}` },
				params: { q: songTitle },
			});
			const hits = response.data.response.hits;
			if (hits.length > 0) {
				const song = hits[0].result;
				const songUrl = song.url;

				bot.sendMessage(chatId, `Fetching lyrics for ${song.full_title}...`);
				const lyrcs = await fetchlyrics.fetchLyrics(songUrl);
				const formattedLyrics = fetchlyrics.formatLyrics(lyrcs);
				const lyricParts = fetchlyrics.splitMessage(formattedLyrics);

				for (const part of lyricParts) {
					await bot.sendMessage(chatId, part, { parse_mode: "Markdown" });
				}
			} else {
				bot.sendMessage(chatId, `Sorry, I couldnt find the lyrics. Please try again.`);
			}
		} catch (error) {
			console.error("Error fetching lyrics", error);
			bot.sendMessage(chatId, `There was error fetching the lyrics for ${songTitle}`);
		}
	} else {
		bot.sendMessage(chatId, "Please provide a song title");
	}
});

app.get("/", async (req, res) => {
	res.send("this is a starting point....");
});

app.listen(PORT, () => {
	console.log("App listening on port ", PORT);
});
