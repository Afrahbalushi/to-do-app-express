const express = require('express');
const bodyParser = require('body-parser');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const sequelize = require('sequelize');
const amqp = require('amqplib');
const { Strategy, ExtractJwt } = require('passport-jwt');


const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(passport.initialize());



const opts = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: 'secret'
};

module.exports = passport => {
  passport.use(
    new Strategy(opts, (jwt_payload, done) => {
      const user = { id: jwt_payload.sub, name: jwt_payload.name };
      if (user) {
        return done(null, user);
      } else {
        return done(null, false);
      }
    })
  );
};

const db = new sequelize('tododb', 'sa', 'root', {
  dialect: 'mssql',
  host: 'localhost',
  timezone: '+04:00'
});

const Task = db.define('task', {
  name: sequelize.STRING,
  isDone: sequelize.BOOLEAN
});


const User = db.define('user', {
    username: sequelize.STRING,
    password: sequelize.STRING
  });

  User.prototype.validPassword = function(password) {
    return password === this.password;
  };

app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    const existingUser = await User.findOne({ where: { username } });
  
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }
  
    const newUser = await User.create({ username, password });
    res.status(201).json(newUser);
  });
  
  app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ where: { username } });
  
    if (!user || !user.validPassword(password)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
  
    const token = jwt.sign({ id: user.id }, 'secret', { expiresIn: '1h' });
    res.json({ token });
  });

app.post('/tasks', async (req, res) => {
    
      const { name } = req.body;
      const newTask = await Task.create({ name, isDone: false });
      res.status(201).json(newTask);
   
  });
  
  app.put('/tasks/:id', async (req, res) => {
    try {
      const { name, isDone } = req.body;
      await Task.update({ name, isDone }, { where: { id: req.params.id } });
      res.status(200).json({ message: 'Task updated successfully' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  
  app.delete('/tasks/:id', async (req, res) => {
    try {
      await Task.destroy({ where: { id: req.params.id } });
      res.status(200).json({ message: 'Task deleted successfully' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  
  app.get('/tasks', async (req, res) => {
    try {
      const tasks = await Task.findAll();
      res.status(200).json(tasks);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get('/tasks/done', async (req, res) => {
    try {
      const doneTasks = await Task.findAll({ where: { isDone: true } });
      res.status(200).json(doneTasks);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
 
  app.get('/tasks/notdone',  async (req, res) => {
    try {
      const notDoneTasks = await Task.findAll({ where: { isDone: false } });
      res.status(200).json(notDoneTasks);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  
app.put('/tasks/:id/done', async (req, res) => {
    try {
      const task = await Task.findByPk(req.params.id);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }
  
      task.isDone = true;
      await task.save();
  
      const connection = await amqp.connect('amqp://localhost');
      const channel = await connection.createChannel();
      const queue = 'task_done';
  
      channel.assertQueue(queue, { durable: false });
      channel.sendToQueue(queue, Buffer.from(`Task ${task.id} marked as done`));
  
      if (queue !== null) {
        console.log(`Received: ${queue}`);
      }


      res.json({ message: 'Task marked as done' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
  

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});