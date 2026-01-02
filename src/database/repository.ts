import { Database, Statement } from "sql.js";
import { BookDetails, Bookmark, Content } from "./interfaces";

export class Repository {
	db: Database;

	constructor(db: Database) {
		this.db = db;
	}

	getAllBookmark(sortByChapterProgress?: boolean): Promise<Bookmark[]> {
		const query = sortByChapterProgress
			? `select BookmarkID, Text, ContentID, annotation, DateCreated, ChapterProgress
				 from Bookmark
				 where Text is not null
				 order by ChapterProgress ASC, DateCreated ASC;`
			: `select BookmarkID, Text, ContentID, annotation, DateCreated, ChapterProgress
				 from Bookmark
				 where Text is not null
				 order by DateCreated ASC;`;
	
		const res = this.db.exec(query);
		const values = res[0]?.values;
	
		if (!values?.length) {
			console.warn(
				"The bookmarks table returned no results. Do you have any highlights or annotations?"
			);
			return Promise.resolve([]);
		}
	
		const bookmarks: Bookmark[] = [];
	
		for (const row of values) {
			const bookmarkId = row[0];
			const text = row[1];
			const contentId = row[2];
			const dateCreated = row[4];
	
			// 必須カラムの最低限チェック
			if (bookmarkId == null || text == null || contentId == null || dateCreated == null) {
				console.warn("Skipping a bookmark with missing required values.");
				continue;
			}
	
			bookmarks.push({
				bookmarkId: String(bookmarkId),
				text: String(text).replace(/\s+/g, " ").trim(),
				contentId: String(contentId),
				note: row[3] == null ? undefined : String(row[3]),
				dateCreated: new Date(String(dateCreated)),
			});
		}
	
		return Promise.resolve(bookmarks);
	}
	

	getTotalBookmark(): Promise<number> {
		const res = this.db.exec(
			`select count(*) from Bookmark where Text is not null;`,
		);
	
		if (!res.length || !res[0].values?.length) {
			return Promise.resolve(0);
		}
	
		return Promise.resolve(Number(res[0].values[0][0]));
	}	

	getBookmarkById(id: string): Promise<Bookmark | null> {
		const statement = this.db.prepare(
			`select BookmarkID, Text, ContentID, annotation, DateCreated
			 from Bookmark
			 where BookmarkID = $id;`,
			{ $id: id },
		);
	
		try {
			if (!statement.step()) {
				return Promise.resolve(null);
			}
	
			const row = statement.get();
			const bookmarkId = row?.[0];
			const text = row?.[1];
			const contentId = row?.[2];
			const dateCreated = row?.[4];
	
			if (bookmarkId == null || text == null || contentId == null || dateCreated == null) {
				// 破損DBなどを想定して落とさずに扱う（審査的にも安全）
				console.warn("A bookmark row had missing required values.");
				return Promise.resolve(null);
			}
	
			return Promise.resolve({
				bookmarkId: String(bookmarkId),
				text: String(text).replace(/\s+/g, " ").trim(),
				contentId: String(contentId),
				note: row?.[3] == null ? undefined : String(row[3]),
				dateCreated: new Date(String(dateCreated)),
			});
		} finally {
			statement.free();
		}
	}
	
	getContentByContentId(contentId: string): Promise<Content | null> {
		const statement = this.db.prepare(
			`select Title, ContentID, ChapterIDBookmarked, BookTitle
			 from content
			 where ContentID = $id;`,
			{ $id: contentId },
		);
	
		try {
			const contents = this.parseContentStatement(statement);
	
			if (contents.length > 1) {
				throw new Error("Filtering by contentId yielded more than 1 result.");
			}
	
			return Promise.resolve(contents[0] ?? null);
		} finally {
			statement.free();
		}
	}
	
	getContentLikeContentId(contentId: string): Promise<Content | null> {
		const statement = this.db.prepare(
			`select Title, ContentID, ChapterIDBookmarked, BookTitle
			 from content
			 where ContentID like $id;`,
			{ $id: `%${contentId}%` },
		);
	
		try {
			const contents = this.parseContentStatement(statement);
	
			if (contents.length > 1) {
				console.warn(
					`Filtering by contentId yielded more than 1 result: ${contentId}. Using the first result.`,
				);
			}
	
			return Promise.resolve(contents[0] ?? null);
		} finally {
			statement.free();
		}
	}
	

	getFirstContentLikeContentIdWithBookmarkIdNotNull(contentId: string): Promise<Content | null> {
		const statement = this.db.prepare(
			`select Title, ContentID, ChapterIDBookmarked, BookTitle
			 from content
			 where ContentID like $id
				 and ChapterIDBookmarked IS NOT NULL
			 limit 1;`,
			{ $id: `${contentId}%` },
		);
	
		try {
			const contents = this.parseContentStatement(statement);
			return Promise.resolve(contents[0] ?? null);
		} finally {
			statement.free();
		}
	}
	
	getAllContent(limit = 100): Promise<Content[]> {
		const statement = this.db.prepare(
			`select Title, ContentID, ChapterIDBookmarked, BookTitle
			 from content
			 limit $limit;`,
			{ $limit: limit },
		);
	
		try {
			const contents = this.parseContentStatement(statement);
			return Promise.resolve(contents);
		} finally {
			statement.free();
		}
	}
	
	getAllContentByBookTitle(bookTitle: string): Promise<Content[]> {
		const statement = this.db.prepare(
			`select Title, ContentID, ChapterIDBookmarked, BookTitle
			 from content
			 where BookTitle = $bookTitle;`,
			{ $bookTitle: bookTitle },
		);
	
		try {
			const contents = this.parseContentStatement(statement);
			return Promise.resolve(contents);
		} finally {
			statement.free();
		}
	}
	

	getAllContentByBookTitleOrderedByContentId(bookTitle: string): Promise<Content[]> {
		const statement = this.db.prepare(
			`select Title, ContentID, ChapterIDBookmarked, BookTitle
			 from content
			 where BookTitle = $bookTitle
			 order by ContentID;`,
			{ $bookTitle: bookTitle },
		);
	
		try {
			const contents = this.parseContentStatement(statement);
			return Promise.resolve(contents);
		} finally {
			statement.free();
		}
	}
	

	getBookDetailsByBookTitle(bookTitle: string): Promise<BookDetails | null> {
		const statement = this.db.prepare(
			`select Attribution, Description, Publisher, DateLastRead, ReadStatus, ___PercentRead, ISBN, Series, SeriesNumber, TimeSpentReading
			 from content
			 where Title = $title
			 limit 1;`,
			{ $title: bookTitle },
		);
	
		try {
			if (!statement.step()) {
				return Promise.resolve(null);
			}
	
			const row = statement.get();
			const author = row?.[0];
	
			if (author == null) {
				console.warn("Could not find book details in the database.");
				return Promise.resolve(null);
			}
	
			const dateLastReadRaw = row?.[3];
			const readStatusRaw = row?.[4];
			const percentReadRaw = row?.[5];
			const seriesNumberRaw = row?.[8];
			const timeSpentReadingRaw = row?.[9];
	
			return Promise.resolve({
				title: bookTitle,
				author: String(author),
				description: row?.[1] == null ? undefined : String(row[1]),
				publisher: row?.[2] == null ? undefined : String(row[2]),
				dateLastRead: dateLastReadRaw == null ? undefined : new Date(String(dateLastReadRaw)),
				readStatus: readStatusRaw == null ? 0 : Number(readStatusRaw),
				percentRead: percentReadRaw == null ? 0 : Number(percentReadRaw),
				isbn: row?.[6] == null ? undefined : String(row[6]),
				series: row?.[7] == null ? undefined : String(row[7]),
				seriesNumber: seriesNumberRaw == null ? undefined : Number(seriesNumberRaw),
				timeSpentReading: timeSpentReadingRaw == null ? 0 : Number(timeSpentReadingRaw),
			});
		} finally {
			statement.free();
		}
	}
	

	getAllBookDetails(): Promise<BookDetails[]> {
		const statement = this.db.prepare(
			`select distinct
				 Title,
				 Attribution as Author,
				 Description,
				 Publisher,
				 DateLastRead,
				 ReadStatus,
				 ___PercentRead,
				 ISBN,
				 Series,
				 SeriesNumber,
				 TimeSpentReading
			 from content
			 where Title is not null
			 order by Title asc;`,
		);
	
		try {
			const books: BookDetails[] = [];
	
			while (statement.step()) {
				const row = statement.get();
				const title = row?.[0];
				const author = row?.[1];
	
				if (title == null || author == null) {
					continue;
				}
	
				const dateLastReadRaw = row?.[4];
				const readStatusRaw = row?.[5];
				const percentReadRaw = row?.[6];
				const seriesNumberRaw = row?.[9];
				const timeSpentReadingRaw = row?.[10];
	
				books.push({
					title: String(title),
					author: String(author),
					description: row?.[2] == null ? undefined : String(row[2]),
					publisher: row?.[3] == null ? undefined : String(row[3]),
					dateLastRead: dateLastReadRaw == null ? undefined : new Date(String(dateLastReadRaw)),
					readStatus: readStatusRaw == null ? 0 : Number(readStatusRaw),
					percentRead: percentReadRaw == null ? 0 : Number(percentReadRaw),
					isbn: row?.[7] == null ? undefined : String(row[7]),
					series: row?.[8] == null ? undefined : String(row[8]),
					seriesNumber: seriesNumberRaw == null ? undefined : Number(seriesNumberRaw),
					timeSpentReading: timeSpentReadingRaw == null ? 0 : Number(timeSpentReadingRaw),
				});
			}
	
			return Promise.resolve(books);
		} finally {
			statement.free();
		}
	}
	

	private parseContentStatement(statement: Statement): Content[] {
		const contents: Content[] = [];

		while (statement.step()) {
			const row = statement.get();
			contents.push({
				title: row[0]?.toString() ?? "",
				contentId: row[1]?.toString() ?? "",
				chapterIdBookmarked: row[2]?.toString(),
				bookTitle: row[3]?.toString(),
			});
		}

		return contents;
	}
}
