const config = require('../config');
const db = require('../utils/db');
const express = require('express');

class Route {
  static validateFields (payload, res) {
    if (!payload || !(payload instanceof Object)) {
      res.render('error', { 'error': 'Invalid payload', shouldRetry: true });
      return false;
    }

    const validatePayload = ['clientId', 'prefix', 'shortDesc', 'longDesc'].filter(field => !Object.keys(payload).includes(field));

    if (0 < validatePayload.length) {
      res.render('error', { 'error': `Missing fields ${validatePayload.join(', ')}`, shouldRetry: true });
      return false;
    }

    const { clientId, prefix, shortDesc } = payload;

    if (!/[0-9]{17,21}/.test(clientId)) {
      res.render('error', { 'error': 'Client ID must only consist of numbers and be 17-21 characters in length', shouldRetry: true });
      return false;
    }

    if (1 > prefix.length) {
      res.render('error', { 'error': 'Prefix may not be shorter than 1 character', shouldRetry: true });
      return false;
    }

    if (150 < shortDesc.length) {
      res.render('error', { 'error': 'Short description must not be longer than 150 characters', shouldRetry: true });
      return false;
    }

    return true;
  }

  static configure (server, bot) {
    const router = express.Router();
    server.use('/', router);

    router.get('/', async (req, res) => {
      const bots = await db.table('bots').filter({ 'approved': true });
      bots.forEach(bot => bot.seed = Math.random());

      const randomized = bots.sort((a, b) => a.seed - b.seed);

      res.render('index', { bots: randomized });
    });

    router.get('/queue', async (req, res) => {
      const bots = await db.table('bots').filter({ 'approved': false }).orderBy('added');
      res.render('queue', { bots });
    });

    router.get('/add', async (req, res) => {
      if (!await req.user.isAuthenticated()) {
        return res.redirect('auth/login');
      }

      res.render('add');
    });

    router.post('/add', async (req, res) => {
      const validation = this.validateFields(req.body);

      if (!validation) {
        return;
      }

      const { clientId, prefix, shortDesc, longDesc, inviteUrl } = req.body;
      const user = await bot.fetchUser(clientId);

      if (!user) {
        return res.render('error', { 'error': 'Unable to find information related to the clientId', shouldRetry: true });
      }

      if (await db.table('bots').get(clientId).coerceTo('bool')) {
        return res.render('error', { 'error': `${user.username} is already listed!` });
      }

      if (!user.bot) {
        return res.render('error', { 'error': 'The specified clientId is not associated with a bot', shouldRetry: true });
      }

      const owner = bot.listGuild.members.get(await req.user.id());

      if (!owner) {
        return res.render('error', { 'error': 'You need to be in the server to add bots' });
      }

      await db.table('bots').insert({
        id: clientId,
        invite: inviteUrl,
        prefix,
        shortDesc,
        longDesc,
        username: user.username,
        avatar: user.avatar,
        discriminator: user.discriminator,
        owner: owner.id,
        approved: false,
        added: Date.now()
      });

      res.render('added');
      bot.createMessage(config.management.listLogChannel, `${owner.username} added ${user.username} (<@${user.id}>)`);
    });

    router.get('/edit', async (req, res) => {
      if (!req.query.id) {
        return res.redirect('/');
      }

      const bot = await db.table('bots').get(req.query.id);

      if (!bot) {
        return res.render('error', { 'error': 'No bots found with that ID' });
      }

      res.render('add', { 'editing': true, ...bot });
    });

    // TODO: Move edit stuff to /bot/:id/edit
    router.post('/edit', async (req, res) => {
      if (!await req.user.isAuthenticated()) {
        return res.redirect('auth/login');
      }

      const validation = this.validateFields(req.body);

      if (!validation) {
        return;
      }

      const { clientId, prefix, shortDesc, longDesc, inviteUrl } = req.body;
      const editedBot = await db.table('bots').get(clientId);

      if (!editedBot) {
        return res.render('error', { 'error': 'You cannot edit a bot that does not exist' });
      }

      const owner = await req.user.id();

      if (owner !== editedBot.owner) {
        return res.render('error', { 'error': 'You are not the owner of that bot' });
      }

      const ownerUser = await bot.fetchUser(owner);

      await db.table('bots').get(clientId).update({
        invite: inviteUrl,
        prefix,
        shortDesc,
        longDesc
      });

      res.redirect(`/bot/${clientId}`);
      bot.createMessage(config.management.listLogChannel, `${ownerUser.username} edited ${editedBot.username} (<@${editedBot.id}>)`);
    });

    // TODO: Move to bot route
    router.get('/delete', async (req, res) => {
      if (!await req.user.isAuthenticated()) {
        return res.redirect('auth/login');
      }

      if (!req.query.id) {
        return res.redirect('/');
      }

      const currentId = await req.user.id();
      const currentUser = bot.listGuild.members.get(currentId);
      const botInfo = await db.table('bots').get(req.query.id);

      if (!botInfo) {
        return res.render('error', { 'error': 'No bot exists with with that ID' });
      }

      if (currentId !== botInfo.owner) {
        if (!currentUser || !currentUser.roles.some(id => id === config.management.websiteAdminRole)) {
          return res.render('error', { 'error': 'You do not have permission to do that' });
        }
      }

      const botMember = bot.listGuild.members.get(req.query.id);

      if (botMember) {
        await botMember.kick(`Removed by ${currentUser ? currentUser.name : currentId}`);
      }

      await db.table('bots').get(req.query.id).delete();
      res.redirect('/');

      bot.createMessage(config.management.listLogChannel, `${currentUser ? currentUser.username : `<@${currentId}>`} deleted ${botInfo.username} (<@${botInfo.id}>)`);
    });
  }
}

module.exports = Route;
