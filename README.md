# The Rift Web Server

The Rift web server is the REST API behind
[The Rift website](https://github.com/jason-liu-se/the-rift-website) for the
Minecraft server community. It is a Node.js application built with Express and
Mongoose, and it serves news, gallery, and download content stored in MongoDB.

The server is read-only (for now): every endpoint is a `GET` that returns JSON.
Content is added to MongoDB directly; see [Data model](#data-model).

## Requirements

- Node.js at the version in [`.nvmrc`](./.nvmrc) (run `nvm use`)
- npm 11.x
- A MongoDB instance reachable from the server (local or hosted, e.g. Atlas)

## Getting started

Create a `.env` file in the repository root with the
[environment variables](#environment-variables) below, then run:

```bash
npm ci
npm start
```

The server listens on <http://localhost:4000/> by default.

### Environment variables

The server loads these from `.env` in the repository root.

| Variable                    | Required | Description                                                               |
| --------------------------- | -------- | ------------------------------------------------------------------------- |
| `MONGODB_CONNECTION_STRING` | Yes      | MongoDB connection URI.                                                   |
| `PORT`                      | No       | Port to listen on. Defaults to `4000`, which the website expects locally. |

## Npm scripts

| Command                | Description                                          |
| ---------------------- | ---------------------------------------------------- |
| `npm start`            | Start the server with `index.js`.                    |
| `npm run lint`         | Check JavaScript with ESLint.                        |
| `npm run lint:fix`     | Fix ESLint problems that can be fixed automatically. |
| `npm run format`       | Format every file with Prettier.                     |
| `npm run format:check` | Check formatting without writing changes.            |

A Husky pre-commit hook runs ESLint and Prettier on staged files. Formatting
rules live in `.prettierrc` and `.editorconfig`; lint rules in
`eslint.config.js`.

## Testing

> > > TODO: Write unit and integration tests

## Project structure

```text
.
├── helpers/
│   └── mongoManager.js   MongoDB connection and all database queries
├── models/               Mongoose schemas, one file per database
├── routes/               Express routers, one file per URL prefix
└── index.js              App entry point: CORS headers, router mounting, listen
```

## Architecture

`index.js` loads the environment, connects to MongoDB through
`helpers/mongoManager.js`, sets the CORS headers, and mounts one Express router
per URL prefix from `routes/`.

The API is public and read-only, so CORS allows any origin
(`Access-Control-Allow-Origin: *`).

Routers parse query parameters and call `mongoManager`, which owns every
database query and returns plain results to the router. Routers do not query
Mongoose models directly.

### Endpoints

| Method and path                       | Query parameters                               | Returns                                                              |
| ------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| `GET /news/get-items`                 | `startIndex`, `limit`                          | News items, newest first                                             |
| `GET /news/count-items`               |                                                | `{ "count": number }`                                                |
| `GET /gallery/get-collection`         | `collection` (required), `startIndex`, `limit` | Images in a gallery collection                                       |
| `GET /gallery/count-collection-items` | `collection` (required)                        | `{ "count": number }`                                                |
| `GET /downloads/get-collection`       | `collection` (required)                        | Items in a download collection                                       |
| `GET /downloads/get-all`              |                                                | `[{ "name": string, "items": [...] }]` for every download collection |

`startIndex` defaults to `0`. Omitting `limit` returns every item from
`startIndex` onwards. A missing `collection` returns a JSON object with an
`error` field.

`routes/map.js` mounts `GET /map/test`, which served a static map export that
has since been removed from the repository; the route currently returns an
error.

### Data model

Each content type lives in its own MongoDB database, with schemas in `models/`:

| Database    | Collections                                       | Schema                       |
| ----------- | ------------------------------------------------- | ---------------------------- |
| `news`      | `news-items`                                      | `models/news-schema.js`      |
| `gallery`   | One per gallery, named by the website             | `models/gallery-schema.js`   |
| `downloads` | One per download group, all returned by `get-all` | `models/downloads-schema.js` |

Collection names are used as-is (pluralization is off), and the server does not
create collections, so a new gallery or download group is added by creating its
collection in MongoDB.

## Troubleshooting

### Endpoints return empty responses

Confirm that `MONGODB_CONNECTION_STRING` is set and reachable, and that the
database and collection names match the [data model](#data-model). Query errors
are logged to the server console rather than returned to the caller.
