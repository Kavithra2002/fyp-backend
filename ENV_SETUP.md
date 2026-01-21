# Environment variables for auth and MySQL

1. **Create the database and `users` table**  
   In DBeaver, open `sql/init.sql` and run it while connected to **DB_FYP** (no database needs to be selected). It creates the `db_fyp` database and the `users` table.

2. **Create a `.env` file** in the `backend` folder with:

```
# MySQL (use the same as in DBeaver)
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_mysql_password
MYSQL_DATABASE=db_fyp

# JWT secret (use a long random string in production)
JWT_SECRET=your-jwt-secret-change-this
```

Use the same host, user, password, and database as in your DBeaver connection.
The `dotenv` package loads `.env` when the backend starts.
