-- ADM-03: how far a sensitive species' locations are blurred, as a grid cell in degrees (0.1° ≈ 11 km).
ALTER TABLE species ADD COLUMN obscure_cell numeric NOT NULL DEFAULT 0.1 CHECK (obscure_cell IN (0.1, 0.2, 0.5));
