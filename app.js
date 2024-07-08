const express = require('express');
const bodyParser = require('body-parser');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const sequelize = require('sequelize');
const amqp = require('amqplib');
const { Strategy, ExtractJwt } = require('passport-jwt');
const bcrypt = require('bcryptjs'); 

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(passport.initialize());


const db = new sequelize('tododb', 'sa', 'root', {
  dialect: 'mssql',
  host: 'localhost',
  timezone: '+04:00'
});


const Task = db.define('task', {
    name: {
      type: sequelize.STRING,
      allowNull: false
    },
    isDone: {
      type: sequelize.BOOLEAN,
      defaultValue: false
    }
  });
  

  const User = db.define('user', {
    username: {
      type: sequelize.STRING,
      allowNull: false,
      unique: true
    },
    password: {
      type: sequelize.STRING,
      allowNull: false
    }
  }, {
    hooks: {
      beforeCreate: async (user) => {
        const hashedPassword = await bcrypt.hash(user.password, 10); 
        user.password = hashedPassword;
      }
    }
  });

  User.prototype.validPassword = async function(password) {
    return await bcrypt.compare(password, this.password); 
  };

  User.hasMany(Task, { foreignKey: 'userId' });
  Task.belongsTo(User, { foreignKey: 'userId' });


db.sync()
  .then(() => {
    console.log('Database & tables created!');
  })
  .catch((error) => {
    console.error('Error creating database & tables:', error);
  });

const opts = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: 'secret'
};



passport.use(new Strategy(opts, async (jwt_payload, done) => {
    try {
      const user = await User.findByPk(jwt_payload.id); 
      if (user) {
        return done(null, user);
      } else {
        return done(null, false);
      }
    } catch (error) {
      return done(error, false);
    }
  }));

  const authenticate = passport.authenticate('jwt', { session: false });

  app.use((req, res, next) => {
    console.log('Authorization Header:', req.headers.authorization);
    next();
  });



app.post('/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

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



app.post('/tasks', authenticate, async (req, res) => {
    const { name } = req.body;

    if (!name) {
        return res.status(400).json({ error: 'Task name is required' });
    } else if (name.length > 255) {
        return res.status(400).json({ error: 'Task name should not exceed 255 characters' });
    }

    try {
        const newTask = await Task.create({ name, isDone: false, userId: req.user.id});
        res.status(201).json(newTask);
    } catch (error) {
        console.error('Error creating task:', error);
        res.status(500).json({ error: 'Error creating task' });
    }
});



app.get('/tasks',authenticate, async (req, res) => {
    console.log('Authenticated user:', req.user);
  try {
    const tasks = await Task.findAll({ where: { userId: req.user.id } });
    res.status(200).json(tasks);
  } catch (error) {
    res.status(400).json({ error: 'Tasks not found' });
    console.error('Error fetching tasks:', error);
  }
});



app.get('/tasks/done', authenticate, async (req, res) => {
  try {
    const doneTasks = await Task.findAll({ where: { userId: req.user.id, isDone: true } });
    res.status(200).json(doneTasks);
  } catch (error) {
    res.status(400).json({ error: 'Tasks not found' });
    console.error('Error fetching done tasks:', error);
  }
});



app.get('/tasks/notdone', authenticate, async (req, res) => {
  try {
    const notDoneTasks = await Task.findAll({ where: { userId: req.user.id, isDone: false } });
    res.status(200).json(notDoneTasks);
  } catch (error) {
    res.status(400).json({ error: 'Tasks not found' });
    console.error('Error fetching not done tasks:', error);
  }
});



app.put('/tasks/:id', authenticate, async (req, res) => {
  const { name, isDone } = req.body;
  try {
    const task = await Task.findOne({ where: { id: req.params.id, userId: req.user.id } });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    await task.update({ name, isDone });
    res.status(200).json({ message: 'Task updated successfully' });
  } catch (error) {
    res.status(400).json({ error: 'Failed to update task' });
    console.error('Error updating task:', error);
  }
});



app.delete('/tasks/:id', authenticate, async (req, res) => {
  try {
    const task = await Task.findOne({ where: { id: req.params.id, userId: req.user.id } });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    await task.destroy();
    res.status(200).json({ message: 'Task deleted successfully' });
  } catch (error) {
    res.status(400).json({ error: 'Failed to delete task' });
    console.error('Error deleting task:', error);
  }
});



app.put('/tasks/:id/done', authenticate, async (req, res) => {
  try {
    const task = await Task.findOne({ where: { id: req.params.id, userId: req.user.id } });

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
    res.status(400).json({ error: 'Failed to mark task as done' });
    console.error('Error marking task as done:', error);
  }
});



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
