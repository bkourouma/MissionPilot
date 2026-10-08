import Link from "next/link";
import type { Metadata } from "next";
import "../../../components/qualite/qualite.css";
import { FormulaireOuvertureSuivi } from "../../../components/qualite/FormulaireOuvertureSuivi";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { Carte } from "../../../components/ui/Carte";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../components/ui/EtatListe";
import { chargerServeur } from "../../../lib/api-serveur";
import { formaterDate } from "../../../lib/format";
import type { Mission } from "../../../lib/missions";
import { chargerToutesLesPages } from "../../../lib/pagination";
import {
  cheminSuivis,
  droitsQualite,
  hrefQualite,
  hrefSuivi,
  libelleClasse,
  libelleStatutSuivi,
  libelleType,
  lireFiltresQualite,
  texteParcours,
  tonaliteClasse,
  tonaliteStatutSuivi,
  type PageSuivis,
} from "../../../lib/qualite";
import { exigerConsultationQualite } from "../../../lib/qualite-serveur";
import { STATUTS_SUIVI, STATUT_SUIVI_LIBELLES } from "@missionpilot/shared";

export const metadata: Metadata = { title: "Qualité des livrables" };

/**
 * Tableau des livrables suivis (QUA-01 à QUA-04, QUA-06) : classe de risque, statut, progression
 * du parcours de revue de l'utilisateur. L'ouverture d'un suivi est réservée à qui relit
 * (`qualite.relire`) ; l'API ne montre que les livrables des missions visibles.
 */
export default async function PageQualite({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await exigerConsultationQualite();
  const droits = droitsQualite(session.utilisateur.roles);
  const filtres = lireFiltresQualite(await searchParams);
  const [r, missions] = await Promise.all([
    chargerServeur<PageSuivis>(cheminSuivis(filtres)),
    droits.relire
      ? chargerToutesLesPages<Mission>(chargerServeur, "/api/missions")
      : Promise.resolve(null),
  ]);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Qualité des livrables"
        soustitre="Classe de risque, revue guidée, quatre yeux et signature : plus l'IA produit, plus la relecture humaine doit être exigeante."
        actions={
          droits.relire ? (
            <>
              <Link href="/qualite/acceptation" className="mp-lien-ligne">
                Acceptation de mission
              </Link>
              <Link href="/qualite/satisfaction" className="mp-lien-ligne">
                Satisfaction des clients
              </Link>
            </>
          ) : undefined
        }
      />

      {droits.relire ? (
        <Carte titre="Ouvrir le suivi d'un livrable">
          {missions && missions.ok ? (
            <FormulaireOuvertureSuivi
              missions={missions.donnees.elements.map((m) => ({ id: m.id, intitule: m.intitule }))}
            />
          ) : (
            <p className="mp-texte-doux">
              La liste des missions n&apos;a pas pu être chargée : rechargez la page pour ouvrir un
              suivi.
            </p>
          )}
        </Carte>
      ) : null}

      <section aria-labelledby="titre-suivis" className="mp-pile">
        <h2 id="titre-suivis" className="mp-section__titre">
          {filtres.mission ? "Livrables suivis de la mission" : "Livrables suivis"}
        </h2>
        {filtres.mission ? (
          <p className="mp-texte-doux mp-texte-petit">
            <Link href={`/missions/${filtres.mission}`} className="mp-lien-ligne">
              Retour à la mission
            </Link>{" "}
            ·{" "}
            <Link href={hrefQualite({ statut: filtres.statut })} className="mp-lien-ligne">
              Toutes les missions
            </Link>
          </p>
        ) : null}
        <nav className="mp-qualite__entete-liste" aria-label="Filtrer par statut">
          <Link
            href={hrefQualite({ mission: filtres.mission })}
            className="mp-qualite__filtre"
            aria-current={filtres.statut === "" ? "true" : undefined}
          >
            Tous
          </Link>
          {STATUTS_SUIVI.map((s) => (
            <Link
              key={s}
              href={hrefQualite({ mission: filtres.mission, statut: s })}
              className="mp-qualite__filtre"
              aria-current={filtres.statut === s ? "true" : undefined}
            >
              {STATUT_SUIVI_LIBELLES[s]}
            </Link>
          ))}
        </nav>

        {!r.ok ? (
          <EtatErreur
            titre="Les livrables n'ont pas pu être chargés."
            message={r.message}
            hrefReessayer={hrefQualite(filtres)}
          />
        ) : r.donnees.elements.length === 0 ? (
          <EtatVide
            titre={filtres.curseur ? "Aucun autre livrable." : "Aucun livrable suivi."}
            icone="signature"
          >
            <p>
              {droits.relire
                ? "Ouvrez le suivi d'un livrable ci-dessus : sa classe de risque fixe la garde à franchir."
                : "Les livrables de vos missions apparaîtront ici dès l'ouverture de leur suivi qualité."}
            </p>
          </EtatVide>
        ) : (
          <ul className="mp-liste-lignes">
            {r.donnees.elements.map((s) => (
              <li key={s.id} className="mp-liste-lignes__ligne">
                <div className="mp-liste-lignes__texte">
                  <Link href={hrefSuivi(s.id)} className="mp-lien-ligne">
                    {s.libelle}
                  </Link>
                  <span className="mp-texte-doux mp-texte-petit">
                    {libelleType(s.type_livrable)} · version {s.version} · {s.mission_intitule} ·
                    ouvert le {formaterDate(s.ouvert_le)}
                  </span>
                  <span className="mp-texte-doux mp-texte-petit">
                    {texteParcours({
                      obligatoires: s.elements_obligatoires,
                      vus: s.elements_vus_par_moi,
                      restants: s.elements_obligatoires - s.elements_vus_par_moi,
                      complet: s.elements_vus_par_moi >= s.elements_obligatoires,
                    })}{" "}
                    · {s.validations_faites} validation(s)
                  </span>
                </div>
                <BadgeStatut tonalite={tonaliteClasse(s.classe)}>
                  {libelleClasse(s.classe)}
                </BadgeStatut>
                <BadgeStatut tonalite={tonaliteStatutSuivi(s.statut)}>
                  {libelleStatutSuivi(s.statut)}
                </BadgeStatut>
              </li>
            ))}
          </ul>
        )}
        {r.ok ? (
          <PaginationCurseur
            hrefSuivante={
              r.donnees.curseur_suivant
                ? hrefQualite({ ...filtres, curseur: r.donnees.curseur_suivant })
                : null
            }
            hrefDebut={
              filtres.curseur
                ? hrefQualite({ mission: filtres.mission, statut: filtres.statut })
                : null
            }
          />
        ) : null}
      </section>
    </div>
  );
}
