var express = require('express');
var router = express.Router();
const Event = require("../models/events");
const Organizer = require("../models/organizers")
const User = require("../models/users")
const Transaction = require("../models/transactions")
const Saldo = require("../models/saldos")
const Transfer = require("../models/transfers")
const Deposit = require("../models/deposits")
const Reimburse = require("../models/reimburses")
const fetch = require('node-fetch');

const Checker = require("../models/checkers")

const limiter = require('../limiter')

const Sender = require("mailersend").Sender;
const Recipient = require("mailersend").Recipient;
const EmailParams = require("mailersend").EmailParams;
const { MailerSend } = require("mailersend");

const mailerSend  = new MailerSend({
  apiKey: "mlsn.cb35e7e3e4df13671317cef2750ed1aca8227adb8f9abac599674f5464a45584",
});

// create Payment 

router.post('/paynl-transaction',limiter, async (req, res) => {
  try {
    const user = await User.findOne({ token: req.body.tokenUser });
    let lng = req.body.language
    let newDeposit;
    let saldoInput = req.body.saldoId; // Assurez-vous de récupérer la valeur correctement

    if (saldoInput) {
      newDeposit = new Deposit({
        amount: req.body.amount,
        token: req.body.tokenNumber,
        creationDate: new Date(),
        idPayment: "",
        user: user._id,
        isPaid: false,
        saldo: saldoInput,
        coin : req.body.idCoin
      });
    } else {
      res.status(500).json({ message: 'Erreur pas de saldoId' });
    }

  
      let authorizationCode = 'SL-5893-9892'
      const dataOrganizer = await Organizer.findOne({ saldoOrganizer: req.body.idCoin });
  
      if (dataOrganizer) {
        authorizationCode = dataOrganizer.authorization;
      }

    let languageBankDisplay = 'EN'

    if(lng){
      languageBankDisplay = lng.toUpperCase()
    }

    const amountToPut = req.body.amount*100

    // Attendre l'enregistrement du dépôt
    const savedDeposit = await newDeposit.save();

    const url = 'https://rest.pay.nl/v2/transactions';
    const options = {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Basic QVQtMDA5MC00MDY4OjE2NWVkZDA3MjZlOGNkYTUyZWI0MjVjNWU3ZGM3NmI1YTIyY2E2Yjg=`
      },
      body: JSON.stringify({
        customer: {language: `${languageBankDisplay}`},
        stats: {object: 'Coinpack'},
        serviceId: `${authorizationCode}`,
        amount: { value: amountToPut, currency: 'EUR' },
        integration: { testMode: false },
        description: `CoinPack - ${req.body.saldoName}`,
        reference: `${savedDeposit._id}`,
        returnUrl: `https://coinpack.app/statusPayment?id=${savedDeposit._id}&lng=${lng}`,
        exchangeUrl: `https://backend-coinpack-app.vercel.app/finances/paynl-status/${savedDeposit._id}`
      })
    };

    const response = await fetch(url, options);
    const data = await response.json();


    if(data.orderId) {
      await Deposit.findByIdAndUpdate(savedDeposit._id, { idPayment: data.orderId });
    }

    res.json(data);
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ message: 'Erreur lors du paiement' });
  }
});





// get status

 router.get('/paynl-status/:idDeposit', async (req, res) => {
  try {
    const { idDeposit} = req.params;
    const depositFound = await Deposit.findById(idDeposit);

    if (!depositFound) {
      return res.status(404).json({ message: 'Dépôt non trouvé' });
    }

    // Vérifier si le dépôt a déjà été traité
    if (depositFound.isPaid) {
      return res.status(200).json({ message: 'Dépôt déjà traité', result: true });
    }
    
    const url = `https://rest.pay.nl/v2/transactions/${depositFound.idPayment}/status`;
    const options = {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Basic QVQtMDA5MC00MDY4OjE2NWVkZDA3MjZlOGNkYTUyZWI0MjVjNWU3ZGM3NmI1YTIyY2E2Yjg=`
      }
    };

    const response = await fetch(url, options);
    
    const data = await response.json();

    if (data.status.code === 100) {

      if (depositFound.isPaid) {
        return res.status(200).json({ message: 'Dépôt déjà traité', result: true });
      }

      depositFound.isPaid = true;
      await depositFound.save();
     
        // Effectuer des mises à jour spécifiques pour le dépôt ayant un "saldo"
        const saldoInfoId = depositFound.saldo._id;
        const user = await User.findById(depositFound.user);
        const saldoOtherData = user.saldoOthersData.find(s => s._id.toString() === saldoInfoId.toString());


        if (saldoOtherData) {
          // Mettre à jour un solde "saldoOtherData" existant
          await User.findOneAndUpdate(
            { _id: user._id, 'saldoOthersData._id': saldoInfoId },
            {
              $push: { 'saldoOthersData.$.deposit': depositFound._id },
              $inc: { 'saldoOthersData.$.amount': depositFound.token  }
            }
          );
        } else {
          return res.status(404).json({ message: 'Informations de solde manquantes' });
        }
      
    }

    res.status(200).json(true);
  } catch (error) {
    console.error('Erreur:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération du statut du paiement' });
  }
});

// Create Transaction Out


router.post("/createTransactionOut", async (req, res) => {
  let savedTransaction; // Declare the variable outside the try block.

  try {
    const userIdentity = req.body.userToken;
    const eventId = req.body.eventId;
    const saldoInfoId = req.body.saldoId;
    const numberToken = req.body.numberToken;
    const priceToken = req.body.priceToken;
    const standId = req.body.standId;
    const productsdata = req.body.products 
    const warrantiesdata = req.body.warranties
    const codeData = req.body.enteredCode
    let nameStand = ""
    if(req.body.standName){
      nameStand = req.body.standName
    }

    

    const user = await User.findOne({token : userIdentity});

    if (!user) {
      return res.json({ result: false, message: "User not found" });
    }

    const saldoOtherData = user.saldoOthersData.find(
      (s) => s.saldoInfo.toString() === saldoInfoId && s.isActive === true
    );

      if (!saldoOtherData) {
        return res.json({ result: false, message: "No money deposit on this saldo" });
      }

      if (saldoOtherData.amount < numberToken) {
        return res.json({ result: false, message: "Insufficient funds" });
      }

      saldoOtherData.amount -= numberToken;

      const newTransaction = new Transaction({
        token: numberToken,
        creationDate: new Date(),
        event: eventId,
        stand:standId,
        products: productsdata,
        warranties : warrantiesdata,
        user: user._id,
        saldo: saldoInfoId,
        nameStand : nameStand,
        code : codeData
      });
      savedTransaction = await newTransaction.save();

      await User.findOneAndUpdate(
        { 
          _id: user._id, 
          "saldoOthersData._id": saldoOtherData._id,
        },
        {
          $push: { 'saldoOthersData.$.transactions': savedTransaction._id },
          $set: { 'saldoOthersData.$.amount': saldoOtherData.amount }
        }
      )

      await notifyCheckers(savedTransaction);

    res.json({ result: true, message: "Transaction saved", transaction: savedTransaction });

  } catch (error) {
    console.error('Error:', error);
    res.json({ result: false, message: "Error saving transaction" });
  }
});
  

// reimburse initiation
router.post("/reimburseInitiation", async (req, res) => {
  try {
    const { userToken, saldoId } = req.body;

    if (!userToken || !saldoId) {
      return res.status(400).json({ result: false, error: "Missing", message: "Missing required data" });
    }

    const user = await User.findOne({ token: userToken });

    if (!user) {
      return res.status(404).json({ result: false, error: "Missing", message: "User not found" });
    }

    const existingReimburse = await Reimburse.findOne({ user: user._id, saldo: saldoId, isAsked: true });

    if (existingReimburse) {
      return res.status(400).json({ result: false, error: "Already exists", message: "A reimbursement already exists for this user and saldo" });
    }

    const saldo = await Saldo.findOne({ _id: saldoId });

    const newReimburse = new Reimburse({
      creationDate: new Date(),
      dateAsked: null,
      dateDone: null,
      isAsked: false,
      isDone: false,
      accountNumber: '',
      numberToken: 0,
      priceToken: saldo.priceReimburse,
      commission: saldo.commissionReimburse,
      amount: 0,
      user: user._id,
      saldo: saldoId,
    });

    await newReimburse.save();

    // Trouver le bon saldoOthers et ajouter l'ID du remboursement
    const saldoOthers = user.saldoOthersData.find(
      (so) => so.saldoInfo.toString() === saldoId.toString() && so.isActive
    );

    if (saldoOthers) {
      saldoOthers.refund.push(newReimburse._id);
      await user.save();
    }

    res.json({ result: true, message: "Reimburse created", data: newReimburse });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ result: false, message: "Error creating reimburse" });
  }
});


// route with push 


const sendPushNotification = async (token, coin, stand, event) => {
  const message = {
    to: token,
    sound: 'default',
    title: `${event}`,
    body: `You received ${coin} coins for ${stand}`,
    data: { data: "goes here" },
  };

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send?useFcmV1=true'
    /*const response = await fetch('https://exp.host/--/api/v2/push/send'*/, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const data = await response.json();
    console.log('Push notification response:', data);

    if (response.ok) {
      console.log('Notification sent successfully:', data);
    } else {
      console.error('Error sending notification:', data);
    }
  } catch (error) {
    console.error('Error sending push notification:', error);
  }
};


/*async function notifyCheckers(transaction) {
  try {
    const eventDetails = await Event.findById(transaction.event);
    const transactionStandId = transaction.stand.toString();

    const stand = eventDetails.standsData.find(s => s._id.toString() === transactionStandId);
  
    if (stand && stand.codeExtra) {
      const codeObject = stand.codeExtra.find(codeExtra => codeExtra.code.map(String).join('') === transaction.code);


      if (codeObject) {
        const checkerIds = codeObject.users;
        const checkers = await Checker.find({ '_id': { $in: checkerIds.map(id => id.toString()) } });
        for (const checker of checkers) {
          if (checker.pushToken) {
            await sendPushNotification(checker.pushToken, transaction.token, transaction.nameStand, eventDetails.nameEvent).catch(err => console.error("Error sending notification to checker", checker._id, err));
          }
        }
      }
    }
  } catch (error) {
    console.error("Failed to send notification", error);
    throw error;
  }
}*/


async function notifyCheckers(transaction) {
  try {
    const eventDetails = await Event.findById(transaction.event);
    const transactionStandId = transaction.stand.toString();

    const stand = eventDetails.standsData.find(s => s._id.toString() === transactionStandId);

    if (stand && stand.codeExtra) {
      const codeObject = stand.codeExtra.find(codeExtra => codeExtra.code.map(String).join('') === transaction.code);

      if (codeObject) {
        const checkerIds = codeObject.users;
        const checkers = await Checker.find({ '_id': { $in: checkerIds.map(id => id.toString()) } });

        for (const checker of checkers) {
          if (checker.pushToken) {
            await sendPushNotification(checker.pushToken, transaction.token, transaction.nameStand, eventDetails.nameEvent)
              .catch(err => console.error("Error sending notification to checker", checker._id, err));
          }

          // Ajout de la transaction dans l'array transactions du checker
          const actionPlaceIndex = checker.actionPlace.findIndex(
            ap => ap.event.toString() === transaction.event.toString()
          );

          if (actionPlaceIndex !== -1) {
            const standIndex = checker.actionPlace[actionPlaceIndex].stand.findIndex(
              s => s.standId.toString() === transaction.stand.toString()
            );

            if (standIndex !== -1) {
              checker.actionPlace[actionPlaceIndex].stand[standIndex].transactions.push(transaction._id);
              await checker.save().catch(err => console.error("Error saving transaction to checker", checker._id, err));
            }
          }
        }
      }
    }
  } catch (error) {
    console.error("Failed to send notification", error);
    throw error;
  }
}


// transfer between users

router.post('/transferTokens', async (req, res) => {
  const { tokenSender, idReceiver, numberToken, saldoOthersId, saldoInfoId, saldoName } = req.body;

  try {
    const sender = await User.findOne({ token: tokenSender });
    if (!sender) {
      return res.status(404).json({ message: "Sender not found" });
    }

    const receiver = await User.findById(idReceiver);
    if (!receiver) {
      return res.status(404).json({ message: "Receiver not found" });
    }

    const senderSaldo = sender.saldoOthersData.find(saldo => saldo._id.toString() === saldoOthersId && saldo.isActive);
    if (!senderSaldo) {
      return res.status(400).json({ message: "Sender's saldo is not active or not found" });
    }

    if (senderSaldo.amount < numberToken) {
      return res.status(400).json({ message: "Sender has insufficient tokens" });
    }

    senderSaldo.amount -= numberToken;
    let receiverSaldo = receiver.saldoOthersData.find(saldo => saldo.saldoInfo.toString() === saldoInfoId && saldo.isActive);

    if (!receiverSaldo) {
      receiverSaldo = {
        amount: 0,
        saldoInfo: saldoInfoId,
        transactions: [],
        deposit: [],
        refund: [],
        isActive: true,
      };
      receiver.saldoOthersData.push(receiverSaldo);
    }

    receiverSaldo.amount += numberToken;

    const newTransfer = new Transfer({
      amount: numberToken,
      token: numberToken,
      creationDate: new Date(),
      sender: sender._id,
      receiver: receiver._id,
      saldo: saldoInfoId,
    });

    await newTransfer.save();
    await sender.save();
    await receiver.save();

    // Send email to sender
    const senderEmailParams = new EmailParams()
      .setFrom(new Sender("hello@coinpack.eu", "Coinpack"))
      .setTo([new Recipient(sender.email, sender.userData.name)])
      .setTemplateId('3zxk54vjjyq4jy6v') // replace with your template ID
      .setPersonalization([{
        email: sender.email,
        data: {
          firstname: sender.userData.name,
          receivername: receiver.userData.name,
          tokenamount: numberToken,
          saldoname: saldoName,
        },
      }]);

    mailerSend.email.send(senderEmailParams)
      .then(response => console.log(response))
      .catch(error => console.log(error));

    // Send email to receiver
    const receiverEmailParams = new EmailParams()
      .setFrom(new Sender("hello@coinpack.eu", "Coinpack"))
      .setTo([new Recipient(receiver.email, receiver.userData.name)])
      .setTemplateId('o65qngk66kj4wr12') // replace with your template ID
      .setPersonalization([{
        email: receiver.email,
        data: {
          firstname: receiver.userData.name,
          sendername: sender.userData.name,
          tokenamount: numberToken,
          saldoname: saldoName,
        },
      }]);

    mailerSend.email.send(receiverEmailParams)
      .then(response => console.log(response))
      .catch(error => console.log(error));

    res.status(200).json({ message: "Transfer completed successfully" });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "An error occurred during the transfer" });
  }
});
  module.exports = router;