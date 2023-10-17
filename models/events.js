const mongoose = require("mongoose");

const products = mongoose.Schema({
    name: String,
    token: Number
  })

const stands = mongoose.Schema({
    name: String,
    backgroundColor: String,
    firstname: String,
    email: String,
    productsData : [products],
  })

const eventsSchema = mongoose.Schema({
  nameEvent: String,
  descriptionEvent: String,
  startDateEvent : Date,
  endDateEvent: Date,
  pictureEvent: String,
  website : String,
  isActive: Boolean,
  addressPlace : String,
  cityPlace : String,
  countryPlace : String,
  latitude: Number,
  backgroundColor: String,
  longitude: Number,
  priceToken: Number,
  organizer : { type: mongoose.Schema.Types.ObjectId, ref: "organizers" },
  standsData : [stands],
});

const Event = mongoose.model("events", eventsSchema);

module.exports = Event;