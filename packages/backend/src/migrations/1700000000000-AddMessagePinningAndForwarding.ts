import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMessagePinningAndForwarding1700000000000 implements MigrationInterface {
    name = 'AddMessagePinningAndForwarding1700000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add pinning support
        await queryRunner.query(`ALTER TABLE "messages" ADD "isPinned" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "pinnedAt" TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "pinnedBy" uuid`);

        // Add forwarding support
        await queryRunner.query(`ALTER TABLE "messages" ADD "forwardedFromId" uuid`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "originalSenderId" uuid`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "isForwarded" boolean NOT NULL DEFAULT false`);

        // Add indexes for better query performance
        await queryRunner.query(`CREATE INDEX "IDX_messages_isPinned" ON "messages" ("isPinned")`);
        await queryRunner.query(`CREATE INDEX "IDX_messages_forwardedFromId" ON "messages" ("forwardedFromId")`);

        // Add foreign key constraint for forwarded messages
        await queryRunner.query(`
            ALTER TABLE "messages"
            ADD CONSTRAINT "FK_messages_forwardedFrom"
            FOREIGN KEY ("forwardedFromId")
            REFERENCES "messages"("id")
            ON DELETE SET NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Remove foreign key constraint
        await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "FK_messages_forwardedFrom"`);

        // Remove indexes
        await queryRunner.query(`DROP INDEX "IDX_messages_isPinned"`);
        await queryRunner.query(`DROP INDEX "IDX_messages_forwardedFromId"`);

        // Remove columns
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "isForwarded"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "originalSenderId"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "forwardedFromId"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "pinnedBy"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "pinnedAt"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "isPinned"`);
    }
}