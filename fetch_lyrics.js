const axios = require("axios");
const cheerio = require("cheerio");

function splitMessage(message, maxLength = 4096) {
	const parts = [];
	let currentPart = "";

	message.split("\n").forEach((line) => {
		if ((currentPart + line).length > maxLength) {
			parts.push(currentPart);
			currentPart = line + "\n";
		} else {
			currentPart += line + "\n";
		}
	});

	if (currentPart) {
		parts.push(currentPart);
	}

	return parts;
}

function formatLyrics(lyrics) {
	return lyrics
		.replace(/\[(.*?)\]/g, "\n\n*[$1]*\n\n") // Add new lines around section headers and make them bold
		.replace(/([a-z])([A-Z])/g, "$1\n$2"); // Add new lines between lines of lyrics for better readability
}

async function fetchLyrics(songUrl) {
	try {
		const { data } = await axios.get(songUrl);
		const $ = cheerio.load(data);

		let lyrcs = "";
		$(".Lyrics__container, .Lyrics__Container-sc-1ynbvzw-1").each((i, element) => {
			lyrcs += $(element).text() + "\n";
		});
		return lyrcs || "Lyrics not found";
	} catch (error) {
		console.error("Error fetching lyrics: ", error);
		return "Faild to retrieve lyrics";
	}
}

module.exports = {
	fetchLyrics,
	splitMessage,
	formatLyrics,
};
