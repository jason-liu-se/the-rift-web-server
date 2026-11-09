const mongoose = require("mongoose");

const gallerySchema = new mongoose.Schema({
	caption: { type: String, required: true },
	url: { type: String, required: true }
});

const db = mongoose.connection.useDb("gallery");

exports.getModel = (modelName) => {
	return db.model(modelName, gallerySchema);
};
