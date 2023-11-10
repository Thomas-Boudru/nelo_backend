const mongoose = require("mongoose");

const products = mongoose.Schema({
  name: String,
  tokens: Number,
  stand: String
  })

const stands = mongoose.Schema({
    name: String,
    backgroundColor: String,
    code: {},
    productsData : [products],
  })

const eventsSchema = mongoose.Schema({
  nameEvent: String,
  descriptionEvent: String,

  isPermanent: Boolean,

  startDateEvent : Date,
  endDateEvent: Date,

  pictureEvent: String,
  website : String,

  isActive: Boolean,

  namePlace: String,
  addressPlace : String,
  cityPlace : String,
  countryPlace : String,
  latitude: Number,
  longitude: Number,
  backgroundColor: String,

  priceToken: Number,

  isBaseToken: Boolean,
  baseToken: Number,
  isReimburse: Boolean,
  reimburseCode: String,

  isSaldoUnique : Boolean,
  saldoEvent: { type: mongoose.Schema.Types.ObjectId, ref: "saldos" },

  organizer : { type: mongoose.Schema.Types.ObjectId, ref: "organizers" },
  standsData : [stands]
});

const Event = mongoose.model("events", eventsSchema);

module.exports = Event;