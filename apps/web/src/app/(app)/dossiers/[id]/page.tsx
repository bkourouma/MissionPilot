import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { ActionsFait } from "../../../../components/dossier/ActionsFait";
import { CarteFiabilite } from "../../../../components/dossier/CarteFiabilite";
import { EnteteDossier } from "../../../../components/dossier/EnteteDossier";
import { FormulaireFacteur } from "../../../../components/dossier/FormulaireFacteur";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../components/ui/Bouton";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { Icone } from "../../../../components/ui/Icone";
import { Tableau } from "../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../lib/api-serveur";
import {
  cheminExport,
  etatsCourants,
  formaterSource,
  formaterValeurFacteur,
  formaterValeurFait,
  grouperParCategorie,
  STATUT_ETAT,
  STATUT_FAIT,
  type VueDossier,
} from "../../../../lib/dossier";
import { formaterDate, formaterMontantMineur } from "../../../../lib/format";
import { estIdentifiant } from "../../../../lib/identifiant";
import { exigerPermission } from "../../../../lib/session";

export const metadata: Metadata = { title: "Dossier client" };

/** Vue d'ensemble du dossier : fiabilité, propositions, profil, facteurs, finances. */
export default async function PageDossier({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("dossier.lire");
  const peutEcrire = aPermission(utilisateur.roles, "dossier.ecrire");
  const r = await chargerServeur<VueDossier>(`/api/dossiers/${id}`);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre="Dossier client"
          retour={{ href: "/dossiers", libelle: "Dossiers clients" }}
        />
        <EtatErreur
          titre="Le dossier n'a pas pu être chargé."
          message={r.message}
          hrefReessayer={`/dossiers/${id}`}
        />
      </div>
    );
  }
  const d = r.donnees;
  const etats = etatsCourants(d.etats_financiers);

  return (
    <div className="mp-page">
      <EnteteDossier
        client={d.client}
        fiabilite={d.fiabilite}
        actions={
          peutEcrire ? (
            <>
              <a href={cheminExport(id, "zip")} className={classesBouton("secondaire")} download>
                <Icone nom="telechargement" />
                <span>Exporter (ZIP)</span>
              </a>
              <a href={cheminExport(id, "json")} className={classesBouton("discret")} download>
                <span>Exporter (JSON)</span>
              </a>
            </>
          ) : null
        }
      />

      <CarteFiabilite fiabilite={d.fiabilite} />

      {d.propositions.length > 0 ? (
        <Carte titre={`Faits à confirmer (${d.propositions.length})`}>
          <ul className="mp-pile">
            {d.propositions.map((f) => (
              <li key={f.id} className="mp-pile">
                <p>
                  <strong>{f.cle}</strong> : {formaterValeurFait(f.valeur)}{" "}
                  <BadgeStatut tonalite={STATUT_FAIT[f.statut].tonalite}>
                    {STATUT_FAIT[f.statut].libelle}
                  </BadgeStatut>
                  {f.origine === "ia" ? (
                    <BadgeStatut tonalite="neutre">Extrait par l&apos;IA</BadgeStatut>
                  ) : null}
                </p>
                <p>
                  {formaterSource(f.source)} · fiabilité {f.fiabilite} · au{" "}
                  {formaterDate(f.date_effet)} · proposé par {f.auteur.nom}
                </p>
                {peutEcrire ? (
                  <ActionsFait clientId={id} fait={f} utilisateurId={utilisateur.id} />
                ) : null}
              </li>
            ))}
          </ul>
        </Carte>
      ) : null}

      <Carte
        titre="Profil de l'entreprise"
        actions={
          <Link href={`/dossiers/${id}/faits`} className={classesBouton("discret")}>
            Tous les faits
          </Link>
        }
      >
        {d.profil.length === 0 ? (
          <EtatVide titre="Aucun fait confirmé pour l'instant." icone="trombone">
            <p>Chaque fait est daté, sourcé et confirmé par un membre de l&apos;équipe.</p>
          </EtatVide>
        ) : (
          grouperParCategorie(d.profil).map((g) => (
            <section key={g.categorie} aria-label={g.libelle}>
              <h3 className="mp-section__titre">{g.libelle}</h3>
              <dl className="mp-liste-def">
                {g.faits.map((f) => (
                  <div key={f.id}>
                    <dt>{f.cle}</dt>
                    <dd>
                      {formaterValeurFait(f.valeur)}{" "}
                      <span>
                        (au {formaterDate(f.date_effet)} ; {formaterSource(f.source)} ; fiabilité{" "}
                        {f.fiabilite})
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))
        )}
      </Carte>

      <Carte titre="Facteurs de contexte">
        {d.facteurs.length === 0 ? (
          <p>
            Aucun facteur renseigné : la fiabilité des comptes et la part de l&apos;informel
            modulent les analyses.
          </p>
        ) : (
          <Tableau
            legende="Facteurs de contexte en vigueur"
            lignes={d.facteurs}
            cleLigne={(f) => f.id}
            colonnes={[
              { cle: "code", entete: "Facteur" },
              { cle: "valeur", entete: "Valeur", rendu: (f) => formaterValeurFacteur(f.valeur) },
              { cle: "date_effet", entete: "Depuis le", rendu: (f) => formaterDate(f.date_effet) },
              { cle: "source", entete: "Source", rendu: (f) => formaterSource(f.source) },
            ]}
          />
        )}
        {peutEcrire ? (
          <details className="mp-details">
            <summary>Renseigner un facteur</summary>
            <FormulaireFacteur clientId={id} />
          </details>
        ) : null}
      </Carte>

      <Carte
        titre="Finances multi-exercices"
        actions={
          <Link href={`/dossiers/${id}/finances`} className={classesBouton("discret")}>
            {peutEcrire ? "Importer et revoir" : "Détail"}
          </Link>
        }
      >
        <Tableau
          legende="États financiers courants"
          lignes={etats}
          cleLigne={(e) => e.id}
          messageVide="Aucun état financier ingéré."
          colonnes={[
            {
              cle: "exercice",
              entete: "Exercice",
              rendu: (e) => <Link href={`/dossiers/${id}/finances/${e.id}`}>{e.exercice}</Link>,
            },
            {
              cle: "statut",
              entete: "Contrôles",
              rendu: (e) => (
                <BadgeStatut tonalite={STATUT_ETAT[e.statut].tonalite}>
                  {STATUT_ETAT[e.statut].libelle}
                  {e.controles_ok ? "" : ` (${e.ecarts} écart(s))`}
                </BadgeStatut>
              ),
            },
            {
              cle: "actif",
              entete: "Total actif",
              alignement: "droite",
              rendu: (e) => formaterMontantMineur(e.totaux.actif, e.devise),
            },
            {
              cle: "resultat",
              entete: "Résultat",
              alignement: "droite",
              rendu: (e) => formaterMontantMineur(e.totaux.resultat, e.devise),
            },
          ]}
        />
        {d.fiabilite.analyses_indicatives && etats.length > 0 ? (
          <p>Analyses indicatives : la fiabilité des données du client appelle la prudence.</p>
        ) : null}
      </Carte>
    </div>
  );
}
