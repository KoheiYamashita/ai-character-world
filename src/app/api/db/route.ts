import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

export async function GET() {
  const dbPath = path.join(process.cwd(), 'data', 'state.db');

  if (!existsSync(dbPath)) {
    return NextResponse.json(
      { error: 'Database file not found' },
      { status: 404 }
    );
  }

  try {
    const buffer = await readFile(dbPath);
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'inline; filename="state.db"',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to read database file' },
      { status: 500 }
    );
  }
}
