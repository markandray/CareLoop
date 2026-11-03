import app from './app';

const port = Number(process.env.SERVER_PORT ?? 4000);
app.listen(port, '0.0.0.0', () => {
  console.log(`CareLoop server listening on port ${port}`);
});
