import Link from "next/link";
import type { Metadata } from "next";
import "../../../components/appels-offres/appels-offres.css";
import {
  FormulaireFicheAo,
  ImportCsvAo,
} from "../../../components/appels-offres/FormulaireFicheAo";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { Carte } from "../../../components/ui/Carte";
import { Champ } from "../../../components/ui/Champ";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../components/ui/EtatListe";
import { Select } from "../../../components/ui/Select";
import { chargerServeur } from "../../../lib/api-serveur";
import {
  cheminFiches,
  droitsAppelsOffres,
  hrefAppelsOffres,
  hrefFiche,
  libelleStatutAo,
  lireFiltresAo,
  regrouperParStatut,
  texteAlerte,
  tonaliteAlerte,
  tonaliteStatutAo,
  type AlerteCabinet,
  type PageFiches,
} from "../../../lib/appels-offres";
import { exigerLectureAo } from "../../../lib/appels-offres-serveur";
import { formaterDate, formaterMontantMineur } from "../../../lib/format";
import { STATUTS_APPEL_OFFRES } from "@missionpilot/shared";

export const metadata: Metadata = { title: "Appels d'offres" };

/**
 * Pipeline des appels d'offres (AO-01, AO-08) : fiches saisies ou importées à la main, rangées par
 * statut, avec leur score de rapprochement (moteur) et les alertes avant la date limite. La veille
 * automatique multi-sources viendra par des connecteurs ; aucun appel externe ici.
 */
export default async function PageAppelsOffres({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await exigerLectureAo();
  const droits = droitsAppelsOffres(session.utilisateur.roles);
  const filtres = lireFiltresAo(await searchParams);
  const [r, alertes] = await Promise.all([
    chargerServeur<PageFiches>(cheminFiches(filtres)),
    chargerServeur<{ alertes: AlerteCabinet[]; tronque: boolean }>("/api/appels-offres/alertes"),
  ]);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Appels d'offres"
        soustitre="Détection, go/no-go de l'associé, matrice de conformité et rétro-planning jusqu'au dépôt."
      />

      {alertes.ok && alertes.donnees.alertes.length > 0 ? (
        <Carte titre="Échéances à surveiller">
          <ul className="mp-liste-lignes">
            {alertes.donnees.alertes.slice(0, 20).map((a, i) => (
              <li key={`${a.ao_id}-${i}`} className="mp-liste-lignes__ligne">
                <div className="mp-liste-lignes__texte">
                  <Link href={hrefFiche(a.ao_id)} className="mp-lien-ligne">
                    {a.titre}
                  </Link>
                  <span className="mp-texte-doux mp-texte-petit">
                    {texteAlerte({
                      type: a.type,
                      joursRestants: a.jours_restants,
                      etapeLibelle: a.etape_libelle,
                    })}
                  </span>
                </div>
                <BadgeStatut tonalite={tonaliteAlerte(a.jours_restants)}>
                  {a.jours_restants < 0 ? "En retard" : `J-${a.jours_restants}`}
                </BadgeStatut>
              </li>
            ))}
          </ul>
        </Carte>
      ) : null}

      {droits.gerer ? (
        <div className="mp-grille-cartes">
          <Carte titre="Nouvelle fiche">
            <FormulaireFicheAo />
          </Carte>
          <Carte titre="Importer des fiches">
            <ImportCsvAo />
          </Carte>
        </div>
      ) : null}

      <section aria-labelledby="titre-pipeline" className="mp-pile">
        <h2 id="titre-pipeline" className="mp-section__titre">
          Pipeline
        </h2>
        <form
          method="get"
          action="/appels-offres"
          className="mp-filtres"
          aria-label="Filtrer les appels d'offres"
        >
          <div className="mp-grille-champs mp-grille-champs--filtres">
            <Champ libelle="Rechercher" name="q" defaultValue={filtres.q} maxLength={100} />
            <Select
              libelle="Statut"
              name="statut"
              invite="Tous les statuts"
              defaultValue={filtres.statut}
              options={STATUTS_APPEL_OFFRES.map((s) => ({
                valeur: s,
                libelle: libelleStatutAo(s),
              }))}
            />
          </div>
          <button type="submit" className="mp-bouton mp-bouton--secondaire">
            Filtrer
          </button>
        </form>

        {!r.ok ? (
          <EtatErreur
            titre="Les appels d'offres n'ont pas pu être chargés."
            message={r.message}
            hrefReessayer={hrefAppelsOffres(filtres)}
          />
        ) : r.donnees.elements.length === 0 ? (
          <EtatVide titre="Aucun appel d'offres." icone="drapeau">
            <p>
              Saisissez ou importez les avis repérés : le rapprochement avec le cabinet est
              immédiat.
            </p>
          </EtatVide>
        ) : (
          <div className="mp-ao__colonnes">
            {regrouperParStatut(r.donnees.elements)
              .filter((c) => c.fiches.length > 0)
              .map((c) => (
                <section
                  key={c.statut}
                  className="mp-ao__colonne"
                  aria-label={libelleStatutAo(c.statut)}
                >
                  <h3>
                    {libelleStatutAo(c.statut)} ({c.fiches.length})
                  </h3>
                  <ul>
                    {c.fiches.map((f) => (
                      <li key={f.id} className="mp-ao__carte-fiche">
                        <Link href={hrefFiche(f.id)} className="mp-lien-ligne">
                          {f.titre}
                        </Link>
                        <span className="mp-texte-doux mp-texte-petit">
                          {[f.bailleur, f.pays, f.secteur].filter(Boolean).join(" · ") || "—"}
                        </span>
                        <span className="mp-texte-doux mp-texte-petit">
                          Rapprochement {f.score_rapprochement}/100
                          {f.date_limite ? ` · limite ${formaterDate(f.date_limite)}` : ""}
                          {f.montant_estime !== null
                            ? ` · ${formaterMontantMineur(f.montant_estime, f.devise)}`
                            : ""}
                        </span>
                        <BadgeStatut tonalite={tonaliteStatutAo(f.statut)}>
                          {libelleStatutAo(f.statut)}
                        </BadgeStatut>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        )}
        {r.ok ? (
          <PaginationCurseur
            hrefSuivante={
              r.donnees.suivant
                ? hrefAppelsOffres({ ...filtres, curseur: r.donnees.suivant })
                : null
            }
            hrefDebut={
              filtres.curseur ? hrefAppelsOffres({ statut: filtres.statut, q: filtres.q }) : null
            }
          />
        ) : null}
      </section>
    </div>
  );
}
