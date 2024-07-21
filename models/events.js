const mongoose = require("mongoose");

const statistics = mongoose.Schema({
  topUsersByTokens: [],
  topTransactionsByTokens: [],
  generatedAtUTC: Date
  })

const competitions = mongoose.Schema({
  time: Date,
  winner: { type: mongoose.Schema.Types.ObjectId, ref: "users" },
  numberToken: Number,
  })

const products = mongoose.Schema({
  name: String,
  tokens: Number,
  stand: String,
  quantity: Number
  })

const warranties = mongoose.Schema({
  name: String,
  tokens: Number,
  stand: String,
  quantity: Number
  })

const stands = mongoose.Schema({
    name: String,
    backgroundColor: String,
    code: {},
    codeExtra : [],
    productsData : [products],
    warrantiesData : [warranties],
  })

const eventsSchema = mongoose.Schema({
  nameEvent: String,
  descriptionEvent: String,

  isPermanent: Boolean,

  startDateEvent : Date,
  endDateEvent: Date,
  timezone: String,

  pictureEvent: String,
  website : String,

  isActive: Boolean,
  isVisible: Boolean,
  isActiveAdmin: Boolean,
  onlyAdmin : Boolean,

  namePlace: String,
  addressPlace : String,
  cityPlace : String,
  countryPlace : String,
  latitude: Number,
  longitude: Number,
  backgroundColor: String,

  isBaseToken: Boolean,
  baseToken: Number,
  isReimburse: Boolean,
  reimburseCode: String,

  isSaldoUnique : Boolean,
  saldoEvent: { type: mongoose.Schema.Types.ObjectId, ref: "saldos" },

  organizer : { type: mongoose.Schema.Types.ObjectId, ref: "organizers" },
  standsData : [stands],
  competition : [competitions],
  statistic : {statistics}
});

const Event = mongoose.model("events", eventsSchema);

module.exports = Event;