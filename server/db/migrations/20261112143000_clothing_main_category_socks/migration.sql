-- AlterEnum：袜类/腿层单品独立大类（打底袜、连裤袜等）；既有衣橱无袜数据，无需回填
ALTER TYPE "ClothingMainCategory" ADD VALUE IF NOT EXISTS 'SOCKS';
