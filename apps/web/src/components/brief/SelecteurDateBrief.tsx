"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { dateSaisieBrief, hrefBrief, libelleRejeuBrief } from "../../lib/brief";
import { classesBouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";

/**
 * Sélecteur de la date du brief. La date choisie est écrite dans l'URL (`?date=AAAA-MM-JJ`) : le
 * rejeu survit au rechargement et se partage par le lien. Sans JavaScript, le formulaire reste un
 * simple GET vers la même page. Une date hors 2000-2100 est refusée avant l'envoi.
 */
export function SelecteurDateBrief({ date }: { date?: string }) {
  const router = useRouter();
  const [saisie, setSaisie] = useState(date ?? "");
  const [erreur, setErreur] = useState<string | undefined>();

  function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const valide = dateSaisieBrief(saisie);
    if (!valide) {
      setErreur("Choisissez une date valide, entre 2000 et 2100.");
      return;
    }
    setErreur(undefined);
    router.push(hrefBrief(valide));
  }

  return (
    <section className="mp-filtres" aria-label="Date du brief">
      <form method="get" action="/brief" onSubmit={soumettre} noValidate>
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Champ
            libelle="Rejouer le brief à la date du"
            type="date"
            name="date"
            min="2000-01-01"
            max="2100-12-31"
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            erreur={erreur}
          />
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("primaire")}>
            Afficher cette date
          </button>
          {date ? (
            <Link href={hrefBrief()} className={classesBouton("secondaire")} prefetch={false}>
              Revenir à aujourd&apos;hui
            </Link>
          ) : null}
        </div>
      </form>
      <p role="status" className={date ? "mp-champ__aide" : "mp-visuellement-cache"}>
        {libelleRejeuBrief(date)}
      </p>
    </section>
  );
}
