const mongoose = require("mongoose");

const statisticsSchema = mongoose.Schema({
  topUsersByTokens: [
    {
      _id: mongoose.Schema.Types.ObjectId,
      totalTokens: Number,
      userData: {
        pseudo: String,
        picture: String
      }
    }
  ],
  topTransactionsByTokens: [
    {
      _id: mongoose.Schema.Types.ObjectId,
      maxToken: Number,
      userData: {
        pseudo: String,
        picture: String
      }
    }
  ],
  generatedAtUTC: Date
});

const competitionsSchema = mongoose.Schema({
  time: Date,
  winner: { type: mongoose.Schema.Types.ObjectId, ref: "users" },
  numberToken: Number,
});

const productsSchema = mongoose.Schema({
  name: String,
  tokens: Number,
  stand: String,
  quantity: Number
});

const warrantiesSchema = mongoose.Schema({
  name: String,
  tokens: Number,
  stand: String,
  quantity: Number
});

const standsSchema = mongoose.Schema({
  name: String,
  backgroundColor: String,
  code: {},
  codeExtra: [],
  productsData: [productsSchema],
  warrantiesData: [warrantiesSchema],
});

const eventsSchema = mongoose.Schema({
  nameEvent: String,
  descriptionEvent: String,
  isPermanent: Boolean,
  startDateEvent: Date,
  endDateEvent: Date,
  timezone: String,
  pictureEvent: String,
  website: String,
  isActive: Boolean,
  isVisible: Boolean,
  isActiveAdmin: Boolean,
  onlyAdmin: Boolean,
  namePlace: String,
  addressPlace: String,
  cityPlace: String,
  countryPlace: String,
  latitude: Number,
  longitude: Number,
  backgroundColor: String,
  isBaseToken: Boolean,
  baseToken: Number,
  isReimburse: Boolean,
  reimburseCode: String,
  isSaldoUnique: Boolean,
  saldoEvent: { type: mongoose.Schema.Types.ObjectId, ref: "saldos" },
  organizer: { type: mongoose.Schema.Types.ObjectId, ref: "organizers" },
  standsData: [standsSchema],
  competition: { 
    active: Boolean, 
    competitions: [competitionsSchema] 
  },
  statistic: { 
    visible: Boolean,
    statistics: statisticsSchema 
  }
});

const Event = mongoose.model("events", eventsSchema);

module.exports = Event;