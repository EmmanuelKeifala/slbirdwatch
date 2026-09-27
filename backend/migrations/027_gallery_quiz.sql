-- Quiz (QZ-12): verifiers can pull a gallery photo out of quizzes, like other quiz media.
ALTER TABLE species_gallery ADD COLUMN quiz_suitable boolean NOT NULL DEFAULT true;
