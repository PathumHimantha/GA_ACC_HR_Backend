exports.login = (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: "Username is required" });
  }

  res.json({ token: `fake-token-for-${username}` });
};
