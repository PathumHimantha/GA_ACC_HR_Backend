const express = require("express");
const usersController = require("../controllers/users.controller");
const auth = require("../middleware/auth");

const router = express.Router();

router.get("/", auth, usersController.listUsers);

module.exports = router;
