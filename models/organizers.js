const mongoose = require("mongoose");


const bank = mongoose.Schema({
    nameAccount: String,
    numberAccount: String,
  })

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
    languagePayNl: String,
    address : String,
    city: String,
    postCode: String,
    country: String,
    vat: String,
    tariff: String,
    event : [{ type: mongoose.Schema.Types.ObjectId, ref: "events" }],
    saldoOrganizer: [{ type: mongoose.Schema.Types.ObjectId, ref: "saldos" }],
    userData : [adminUser],
    bankData : bank,
    authorization : String
    
});

const Organizer = mongoose.model("organizers", organizersSchema);

module.exports = Organizer;