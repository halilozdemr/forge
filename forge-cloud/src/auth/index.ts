import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { prisma } from '../utils/prisma';
import { createId } from '@paralleldrive/cuid2';

export const authRoutes: FastifyPluginAsyncZod = async (fastify) => {
  // POST /auth/register
  fastify.post('/register', {
    schema: {
      body: z.object({
        email: z.string().email(),
        password: z.string().min(6)
      })
    }
  }, async (request, reply) => {
    const { email, password } = request.body;
    
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.code(400).send({ error: 'Email already in use' });
    }
    
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, passwordHash }
    });
    
    const sessionId = createId();
    const token = fastify.jwt.sign({ userId: user.id, sessionId }, { expiresIn: '30d' });
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    
    await prisma.userSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        token,
        expiresAt,
      }
    });
    
    return reply.code(201).send({ token, expiresAt });
  });

  // POST /auth/login
  fastify.post('/login', {
    schema: {
      body: z.object({
        email: z.string().email(),
        password: z.string()
      })
    }
  }, async (request, reply) => {
    const { email, password } = request.body;
    
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return reply.code(400).send({ error: 'Invalid credentials' });
    }
    
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return reply.code(400).send({ error: 'Invalid credentials' });
    }

    const sessionId = createId();
    const token = fastify.jwt.sign({ userId: user.id, sessionId }, { expiresIn: '30d' });
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    
    await prisma.userSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        token, 
        expiresAt,
      }
    });

    return reply.code(200).send({ token, expiresAt });
  });

  // GET /auth/me
  fastify.get('/me', {
    onRequest: [fastify.authenticate] // We'll add this decorator in server setup
  }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user.userId },
      select: { id: true, email: true }
    });
    
    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }
    
    return reply.code(200).send({ userId: user.id, email: user.email });
  });

  // GET /auth/cli
  fastify.get('/cli', {
    schema: { querystring: z.object({ callback: z.string().url() }) }
  }, async (request, reply) => {
    const { callback } = request.query as { callback: string };
    
    reply.type('text/html');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Forge Cloud - CLI Login</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0f172a; color: white; }
    .container { background: #1e293b; padding: 2.5rem; border-radius: 12px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3); width: 100%; max-width: 380px; }
    h2 { margin-top: 0; text-align: center; margin-bottom: 2rem; font-weight: 500; letter-spacing: -0.025em; }
    .form-group { margin-bottom: 1.25rem; }
    label { display: block; margin-bottom: 0.5rem; font-size: 0.875rem; color: #94a3b8; }
    input { width: 100%; padding: 0.75rem; border-radius: 6px; border: 1px solid #334155; background: #0f172a; color: white; box-sizing: border-box; font-size: 1rem; transition: border-color 0.2s; }
    input:focus { outline: none; border-color: #3b82f6; }
    button { width: 100%; padding: 0.75rem; background: #3b82f6; color: white; border: none; border-radius: 6px; font-size: 1rem; font-weight: 500; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #2563eb; }
    .error { padding: 0.75rem; background: #7f1d1d; color: #fca5a5; border-radius: 6px; margin-bottom: 1.5rem; font-size: 0.875rem; display: none; }
    .logo { text-align: center; font-size: 2rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">🔥</div>
    <h2>Log in to Forge Cloud</h2>
    
    <div id="errorBox" class="error"></div>
    
    <form id="cliForm" action="/auth/cli/verify" method="POST">
      <input type="hidden" name="callback" value="${callback}">
      <div class="form-group">
        <label>Email</label>
        <input type="email" name="email" required autofocus>
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" name="password" required>
      </div>
      <button type="submit" id="submitBtn">Authorize CLI</button>
    </form>
    
    <script>
      // Automatically show an error if redirected back with error query param
      const urlParams = new URLSearchParams(window.location.search);
      const error = urlParams.get('error');
      if (error) {
        document.getElementById('errorBox').textContent = error;
        document.getElementById('errorBox').style.display = 'block';
      }
    </script>
  </div>
</body>
</html>`;
  });

  // POST /auth/cli/verify
  // Since the user can submit via standard form, we define it carefully to handle redirects on failure too
  fastify.post('/cli/verify', {
    schema: {
      body: z.object({
        email: z.string().email(),
        password: z.string(),
        callback: z.string().url()
      })
    }
  }, async (request, reply) => {
    const { email, password, callback } = request.body;
    
    const user = await prisma.user.findUnique({ where: { email } });
    
    const isApiRequest = request.headers['content-type'] === 'application/json';
    
    const sendError = (msg: string) => {
      if (isApiRequest) {
        return reply.code(401).send({ error: msg });
      } else {
        return reply.redirect(302, `/auth/cli?callback=${encodeURIComponent(callback)}&error=${encodeURIComponent(msg)}`);
      }
    };
    
    if (!user) return sendError('Invalid credentials');
    
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return sendError('Invalid credentials');

    const sessionId = createId();
    const token = fastify.jwt.sign({ userId: user.id, sessionId }, { expiresIn: '30d' });
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    
    await prisma.userSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        token, 
        expiresAt,
      }
    });

    // Ensure the token param is properly added to callback URL
    const callbackUrl = new URL(callback);
    callbackUrl.searchParams.set('token', token);
    
    return reply.redirect(302, callbackUrl.toString());
  });
};
