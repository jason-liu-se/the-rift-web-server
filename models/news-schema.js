const mongoose = require("mongoose");

const newsSchema = new mongoose.Schema({
	title: { type: String, required: true },
	date: { type: Date, required: true },
	content: { type: String, required: true }
});

const db = mongoose.connection.useDb("news");

exports.model = db.model("news-items", newsSchema);
