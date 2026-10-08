import Link from "next/link";
import type { Metadata } from "next";
import "../../../../components/qualite/qualite.css";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { STATUT_MISSION, type Mission } from "../../../../lib/missions";
import { chargerToutesLesPages } from "../../../../lib/pagination";
import { hrefAcceptation } from "../../../../lib/qualite";
import { exigerRelectureQualite } from "../../../../lib/qualite-serveur";

export const metadata: Metadata = { title: "Acceptation de mission" };

/** Choix de la mission dont on évalue l'acceptation (conflits d'intérêts, profil de risque). */
export default async function PageAcceptations() {
  await exigerRelectureQualite();
  const r = await chargerToutesLesPages<Mission>(chargerServeur, "/api/missions");
  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Acceptation de mission"
        soustitre="Avant de s'engager : conflits d'intérêts avec les clients liés du cabinet et profil de risque du client."
        retour={{ href: "/qualite", libelle: "Qualité" }}
      />
      {!r.ok ? (
        <EtatErreur
          titre="Les missions n'ont pas pu être chargées."
          message={r.message}
          hrefReessayer="/qualite/acceptation"
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucune mission visible." icone="signature">
          <p>Créez une mission pour en évaluer l&apos;acceptation.</p>
        </EtatVide>
      ) : (
        <ul className="mp-liste-lignes">
          {r.donnees.elements.map((m) => (
            <li key={m.id} className="mp-liste-lignes__ligne">
              <div className="mp-liste-lignes__texte">
                <Link href={hrefAcceptation(m.id)} className="mp-lien-ligne">
                  {m.intitule}
                </Link>
                <span className="mp-texte-doux mp-texte-petit">{m.client_raison_sociale}</span>
              </div>
              <BadgeStatut tonalite={STATUT_MISSION[m.statut].tonalite}>
                {STATUT_MISSION[m.statut].libelle}
              </BadgeStatut>
            </li>
          ))}
        </ul>
      )}
      {r.ok && r.donnees.tronquee ? (
        <p className="mp-texte-doux mp-texte-petit">
          La liste est tronquée : affinez depuis la page des missions.
        </p>
      ) : null}
    </div>
  );
}
