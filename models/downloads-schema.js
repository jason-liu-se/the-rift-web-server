const mongoose = require("mongoose");

const downloadsSchema = new mongoose.Schema({
	title: { type: String, required: true },
	desc: { type: String, required: true },
	downloadUrl: { type: String, required: true },
	backgroundUrl: { type: String, required: true }
});

const db = mongoose.connection.useDb("downloads");

exports.getModel = (modelName) => {
	return db.model(modelName, downloadsSchema);
};
