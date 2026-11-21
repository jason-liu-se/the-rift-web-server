// One-off migration, run by hand (README "Data"): moves each per-gallery and
// per-download-group Mongo collection into the shared items collection
// (`images` / `items`, keeping every `_id`) plus a `collections` entry with a
// slug and title. Safe to re-run: what's already moved is skipped. The old
// collections are kept unless --drop-old is passed, and dropped only once all
// their documents are in the new one.
//
//   node --env-file=.env scripts/migrate-content-storage.ts --dry-run
//   node --env-file=.env scripts/migrate-content-storage.ts
//   node --env-file=.env scripts/migrate-content-storage.ts --drop-old
import mongoose, { type Connection } from "mongoose";
import { loadEnv } from "../src/config/env.ts";

interface ContentDatabase {
	readonly name: "gallery" | "downloads";
	readonly itemsCollection: string;
	/** Fields every moved item gains, besides its collection's slug. */
	readonly newItemFields: Readonly<Record<string, unknown>>;
}

const DATABASES: readonly ContentDatabase[] = [
	{ name: "gallery", itemsCollection: "images", newItemFields: { tags: [] } },
	{ name: "downloads", itemsCollection: "items", newItemFields: {} }
];

const COLLECTIONS_COLLECTION = "collections";
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 40;

export interface MigrationOptions {
	readonly dryRun: boolean;
	readonly dropOld: boolean;
}

export interface MovedCollection {
	readonly database: string;
	readonly source: string;
	readonly slug: string;
	readonly title: string;
	readonly documents: number;
	/** Documents already in the items collection (an earlier run). */
	readonly alreadyMoved: number;
	readonly dropped: boolean;
}

export interface MigrationReport {
	readonly moved: MovedCollection[];
	/** Problems that stopped the migration before it wrote anything. */
	readonly problems: string[];
}

// `season5` → `season5`, `Spawn_Builds` → `spawn-builds`.
export function slugFor(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

// The title the website showed before collections had one: `season5` (or
// `season-5`) → `Season 5`. Matches its galleryCollectionTitle.
export function titleFor(name: string): string {
	const words = name
		.replace(/[-_]+/g, " ")
		.replace(/([a-z])(\d)/gi, "$1 $2")
		.trim();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

interface PlannedCollection {
	readonly source: string;
	readonly slug: string;
	readonly title: string;
}

async function sourceCollections(
	db: Connection,
	{ itemsCollection }: ContentDatabase
): Promise<string[]> {
	const collections = await db.listCollections();
	return collections
		.map(({ name }) => name)
		.filter(
			(name) =>
				name !== itemsCollection &&
				name !== COLLECTIONS_COLLECTION &&
				!name.startsWith("system.")
		)
		.toSorted();
}

async function planDatabase(
	db: Connection,
	database: ContentDatabase
): Promise<{ planned: PlannedCollection[]; problems: string[] }> {
	const sources = await sourceCollections(db, database);
	const planned = sources.map((source) => ({
		source,
		slug: slugFor(source),
		title: titleFor(source)
	}));
	const problems: string[] = [];

	for (const { source, slug } of planned) {
		if (!SLUG.test(slug) || slug.length > MAX_SLUG_LENGTH) {
			problems.push(
				`${database.name}.${source}: no valid slug ('${slug}'); rename it`
			);
		}
		const sharing = planned.filter((other) => other.slug === slug);
		if (sharing.length > 1 && sharing[0]?.source === source) {
			problems.push(
				`${database.name}: ${sharing.map((other) => other.source).join(", ")} share the slug '${slug}'; rename one`
			);
		}
	}

	problems.push(...(await idClashes(db, database, planned)));
	return { planned, problems };
}

// An `_id` in two source collections, or already in the items collection
// under another slug, can't be kept.
async function idClashes(
	db: Connection,
	{ name, itemsCollection }: ContentDatabase,
	planned: readonly PlannedCollection[]
): Promise<string[]> {
	const owners = new Map<string, string>();
	const items = db.collection(itemsCollection);
	const problems: string[] = [];

	for (const { source, slug } of planned) {
		const ids = await db
			.collection(source)
			.find({}, { projection: { _id: 1 } })
			.map(({ _id }) => _id)
			.toArray();

		for (const id of ids) {
			const key = String(id);
			const owner = owners.get(key);
			if (owner) {
				problems.push(
					`${name}: _id ${key} is in both ${owner} and ${source}`
				);
			}
			owners.set(key, source);
		}

		const moved = await items
			.find(
				{ _id: { $in: ids }, collection: { $ne: slug } },
				{ projection: { _id: 1 } }
			)
			.toArray();
		for (const { _id } of moved) {
			problems.push(
				`${name}.${itemsCollection}: _id ${String(_id)} from ${source} is already there under another collection`
			);
		}
	}
	return problems;
}

async function moveCollection(
	db: Connection,
	database: ContentDatabase,
	{ source, slug, title }: PlannedCollection,
	{ dryRun, dropOld }: MigrationOptions
): Promise<MovedCollection> {
	const items = db.collection(database.itemsCollection);
	const documents = await db.collection(source).find().toArray();
	const ids = documents.map(({ _id }) => _id);
	const alreadyMoved = await items.countDocuments({
		_id: { $in: ids },
		collection: slug
	});
	const report = {
		database: database.name,
		source,
		slug,
		title,
		documents: documents.length,
		alreadyMoved
	};

	if (dryRun) {
		return { ...report, dropped: false };
	}

	await db
		.collection(COLLECTIONS_COLLECTION)
		.updateOne(
			{ slug },
			{ $setOnInsert: { slug, title } },
			{ upsert: true }
		);
	if (documents.length > 0) {
		await items.bulkWrite(
			documents.map((document) => ({
				updateOne: {
					filter: { _id: document._id },
					update: {
						$setOnInsert: {
							...database.newItemFields,
							...document,
							collection: slug
						}
					},
					upsert: true
				}
			}))
		);
	}

	const moved = await items.countDocuments({
		_id: { $in: ids },
		collection: slug
	});
	const dropped = dropOld && moved === documents.length;
	if (dropped) {
		await db.collection(source).drop();
	}
	return { ...report, dropped };
}

// Map seasons get a unique index on `season` when the server starts, which
// fails while two share a number.
async function duplicateSeasons(connection: Connection): Promise<string[]> {
	const duplicates = await connection
		.useDb("maps")
		.collection("seasons")
		.aggregate<{ _id: unknown }>([
			{ $group: { _id: "$season", count: { $sum: 1 } } },
			{ $match: { count: { $gt: 1 } } }
		])
		.toArray();
	return duplicates.map(
		({ _id }) =>
			`maps.seasons: season ${String(_id)} is stored more than once; keep one`
	);
}

export async function migrateContentStorage(
	connection: Connection,
	options: MigrationOptions
): Promise<MigrationReport> {
	const plans = await Promise.all(
		DATABASES.map(async (database) => {
			const db = connection.useDb(database.name);
			return { database, db, ...(await planDatabase(db, database)) };
		})
	);
	const problems = [
		...plans.flatMap((plan) => plan.problems),
		...(await duplicateSeasons(connection))
	];
	if (problems.length > 0) {
		return { moved: [], problems };
	}

	const moved: MovedCollection[] = [];
	for (const { database, db, planned } of plans) {
		for (const collection of planned) {
			moved.push(await moveCollection(db, database, collection, options));
		}
	}
	return { moved, problems };
}

function printReport({ moved, problems }: MigrationReport, dryRun: boolean) {
	for (const problem of problems) {
		console.error(`PROBLEM: ${problem}`);
	}
	for (const item of moved) {
		const verb = dryRun ? "would move" : "moved";
		const dropped = item.dropped ? ", dropped the old collection" : "";
		console.log(
			`${item.database}.${item.source} ${verb} to '${item.slug}' ("${item.title}"): ${item.documents} documents, ${item.alreadyMoved} already moved${dropped}`
		);
	}
	if (problems.length === 0 && moved.length === 0) {
		console.log("Nothing to move.");
	}
}

async function main(): Promise<void> {
	const options = {
		dryRun: process.argv.includes("--dry-run"),
		dropOld: process.argv.includes("--drop-old")
	};
	// Indexes are the server's job; building them here could fail halfway.
	await mongoose.connect(loadEnv().MONGODB_CONNECTION_STRING, {
		autoIndex: false
	});
	try {
		const report = await migrateContentStorage(
			mongoose.connection,
			options
		);
		printReport(report, options.dryRun);
		if (report.problems.length > 0) {
			process.exitCode = 1;
		}
	} finally {
		await mongoose.disconnect();
	}
}

if (import.meta.main) {
	await main();
}
