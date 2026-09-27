-- QZ-12: verifiers can keep blurry / ambiguous photos out of quizzes.
ALTER TABLE media ADD COLUMN quiz_suitable boolean NOT NULL DEFAULT true;
ALTER TABLE species_images ADD COLUMN quiz_suitable boolean NOT NULL DEFAULT true;
