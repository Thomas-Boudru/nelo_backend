const mongoose = require("mongoose");

const adminUser = mongoose.Schema({
    name: String,
    firstname: String,
    email: String,
    password: String,
    phoneNumber: String,
  })


const organizersSchema = mongoose.Schema({
    name: String,
    picture: String,
    description: String,
    website: String,
    token: String,
    isActive: Boolean,
    isAdmin: Boolean,
    language : String,
    event : [{ type: mongoose.Schema.Types.ObjectId, ref: "events" }],
    userData : [adminUser],
});

const Organizer = mongoose.model("organizers", organizersSchema);

module.exports = Organizer;