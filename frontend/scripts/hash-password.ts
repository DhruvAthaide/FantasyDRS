/**
 * scripts/hash-password.ts
 *
 * Generate a bcrypt hash for the admin password. Prints the hash to stdout
 * with no extra decoration so it's safe to pipe.
 *
 * Usage:
 *   npx tsx scripts/hash-password.ts "yourpassword"
 *
 * Paste the output into Vercel as ADMIN_PASSWORD_HASH. Plaintext password
 * never touches the repo, never touches the network.
 */
import bcrypt from "bcryptjs";

async function main(): Promise<void> {
  const pw = process.argv[2];
  if (!pw || pw.length < 8) {
    process.stderr.write(
      "Usage: npx tsx scripts/hash-password.ts \"<password>\"\n" +
        "Password must be at least 8 characters.\n"
    );
    process.exit(1);
  }
  const hash = await bcrypt.hash(pw, 12);
  process.stdout.write(hash + "\n");
}

main().catch((err: unknown) => {
  process.stderr.write(
    `hash-password failed: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
