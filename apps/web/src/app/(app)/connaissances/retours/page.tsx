import Link from "next/link";
import type { Metadata } from "next";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import {
  cheminRetours,
  hrefRetours,
  lireCurseurRetours,
  tonaliteStatutRetour,
  type RetourResume,
} from "../../../../lib/capitalisation";
import { formaterDate } from "../../../../lib/format";
import { exigerPermission } from "../../../../lib/session";

export const metadata: Metadata = { title: "Retours d'expérience" };

/**
 * Retours d'expérience (CAP-01) des missions visibles : ouverts à la clôture avec un brouillon
 * construit depuis les données de la mission, validés par le chef de mission puis versés à la
 * base de connaissances.
 */
export default async function PageRetours({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission("connaissance.lire");
  const curseur = lireCurseurRetours((await searchParams).curseur);
  const r = await chargerServeur<{ elements: RetourResume[]; curseur_suivant: string | null }>(
    cheminRetours(curseur),
  );
  return (
    <div className="mp-page mp-connaissances">
      <EnteteDePage
        titre="Retours d'expérience"
        soustitre="Contexte, méthode, écarts et leçons de chaque mission terminée. Seuls les retours validés par le chef de mission entrent dans la base de connaissances."
      />
      {!r.ok ? (
        <EtatErreur
          titre="Les retours d'expérience n'ont pas pu être chargés."
          message={r.message}
          hrefReessayer={hrefRetours(curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre={curseur ? "Aucun autre retour." : "Aucun retour d'expérience."}>
          <p>Un retour d&apos;expérience s&apos;ouvre à la clôture d&apos;une mission.</p>
        </EtatVide>
      ) : (
        <ul className="mp-liste-lignes">
          {r.donnees.elements.map((x) => (
            <li key={x.id} className="mp-liste-lignes__ligne">
              <div className="mp-liste-lignes__texte">
                <Link href={`/connaissances/retours/${x.id}`}>
                  <strong>{x.mission_intitule}</strong>
                </Link>
                <span className="mp-texte-doux mp-texte-petit">
                  {x.client} · ouvert le {formaterDate(x.ouvert_le)}
                  {x.valide_le ? ` · validé le ${formaterDate(x.valide_le)}` : ""}
                </span>
              </div>
              <BadgeStatut tonalite={tonaliteStatutRetour(x.statut)}>
                {x.statut === "valide" ? "Validé" : "Brouillon"}
              </BadgeStatut>
            </li>
          ))}
        </ul>
      )}
      {r.ok ? (
        <PaginationCurseur
          hrefSuivante={r.donnees.curseur_suivant ? hrefRetours(r.donnees.curseur_suivant) : null}
          hrefDebut={curseur ? "/connaissances/retours" : null}
        />
      ) : null}
    </div>
  );
}
