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
  statutEtat,
  statutFait,
  type VueDossier,
} from "../../../../lib/dossier";
import { formaterDate, formaterMontantMineur } from "../../../../lib/format";
import { estIdentifiant } from "../../../../lib/identifiant";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Dossier client", "Client file") };
}

/** Vue d'ensemble du dossier : fiabilité, propositions, profil, facteurs, finances. */
export default async function PageDossier({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("dossier.lire");
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const peutEcrire = aPermission(utilisateur.roles, "dossier.ecrire");
  const r = await chargerServeur<VueDossier>(`/api/dossiers/${id}`);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre={t("Dossier client", "Client file")}
          retour={{ href: "/dossiers", libelle: t("Dossiers clients", "Client files") }}
        />
        <EtatErreur
          titre={t("Le dossier n'a pas pu être chargé.", "The file could not be loaded.")}
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
                <span>{t("Exporter (ZIP)", "Export (ZIP)")}</span>
              </a>
              <a href={cheminExport(id, "json")} className={classesBouton("discret")} download>
                <span>{t("Exporter (JSON)", "Export (JSON)")}</span>
              </a>
            </>
          ) : null
        }
      />

      <CarteFiabilite fiabilite={d.fiabilite} />

      {d.propositions.length > 0 ? (
        <Carte
          titre={t(
            `Faits à confirmer (${d.propositions.length})`,
            `Facts to confirm (${d.propositions.length})`,
          )}
        >
          <ul className="mp-pile">
            {d.propositions.map((f) => (
              <li key={f.id} className="mp-pile">
                <p>
                  <strong>{f.cle}</strong>
                  {t(" : ", ": ")}
                  {formaterValeurFait(f.valeur, langue)}{" "}
                  <BadgeStatut tonalite={statutFait(f.statut, langue).tonalite}>
                    {statutFait(f.statut, langue).libelle}
                  </BadgeStatut>
                  {f.origine === "ia" ? (
                    <BadgeStatut tonalite="neutre">
                      {t("Extrait par l'IA", "Extracted by AI")}
                    </BadgeStatut>
                  ) : null}
                </p>
                <p>
                  {formaterSource(f.source, langue)} · {t("fiabilité", "reliability")} {f.fiabilite}{" "}
                  · {t("au", "on")} {formaterDate(f.date_effet, "UTC", langue)} ·{" "}
                  {t("proposé par", "proposed by")} {f.auteur.nom}
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
        titre={t("Profil de l'entreprise", "Company profile")}
        actions={
          <Link href={`/dossiers/${id}/faits`} className={classesBouton("discret")}>
            {t("Tous les faits", "All facts")}
          </Link>
        }
      >
        {d.profil.length === 0 ? (
          <EtatVide
            titre={t("Aucun fait confirmé pour l'instant.", "No confirmed fact yet.")}
            icone="trombone"
          >
            <p>
              {t(
                "Chaque fait est daté, sourcé et confirmé par un membre de l'équipe.",
                "Each fact is dated, sourced and confirmed by a team member.",
              )}
            </p>
          </EtatVide>
        ) : (
          grouperParCategorie(d.profil, langue).map((g) => (
            <section key={g.categorie} aria-label={g.libelle}>
              <h3 className="mp-section__titre">{g.libelle}</h3>
              <dl className="mp-liste-def">
                {g.faits.map((f) => (
                  <div key={f.id}>
                    <dt>{f.cle}</dt>
                    <dd>
                      {formaterValeurFait(f.valeur, langue)}{" "}
                      <span>
                        ({t("au", "on")} {formaterDate(f.date_effet, "UTC", langue)} ;{" "}
                        {formaterSource(f.source, langue)} ; {t("fiabilité", "reliability")}{" "}
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

      <Carte titre={t("Facteurs de contexte", "Context factors")}>
        {d.facteurs.length === 0 ? (
          <p>
            {t(
              "Aucun facteur renseigné : la fiabilité des comptes et la part de l'informel modulent les analyses.",
              "No factor entered: the reliability of the accounts and the share of informal activity adjust the analyses.",
            )}
          </p>
        ) : (
          <Tableau
            legende={t("Facteurs de contexte en vigueur", "Context factors in force")}
            lignes={d.facteurs}
            cleLigne={(f) => f.id}
            colonnes={[
              { cle: "code", entete: t("Facteur", "Factor") },
              {
                cle: "valeur",
                entete: t("Valeur", "Value"),
                rendu: (f) => formaterValeurFacteur(f.valeur, langue),
              },
              {
                cle: "date_effet",
                entete: t("Depuis le", "Since"),
                rendu: (f) => formaterDate(f.date_effet, "UTC", langue),
              },
              {
                cle: "source",
                entete: "Source",
                rendu: (f) => formaterSource(f.source, langue),
              },
            ]}
          />
        )}
        {peutEcrire ? (
          <details className="mp-details">
            <summary>{t("Renseigner un facteur", "Set a factor")}</summary>
            <FormulaireFacteur clientId={id} />
          </details>
        ) : null}
      </Carte>

      <Carte
        titre={t("Finances multi-exercices", "Multi-year finances")}
        actions={
          <Link href={`/dossiers/${id}/finances`} className={classesBouton("discret")}>
            {peutEcrire ? t("Importer et revoir", "Import and review") : t("Détail", "Details")}
          </Link>
        }
      >
        <Tableau
          legende={t("États financiers courants", "Current financial statements")}
          lignes={etats}
          cleLigne={(e) => e.id}
          messageVide={t("Aucun état financier ingéré.", "No financial statement ingested.")}
          colonnes={[
            {
              cle: "exercice",
              entete: t("Exercice", "Fiscal year"),
              rendu: (e) => <Link href={`/dossiers/${id}/finances/${e.id}`}>{e.exercice}</Link>,
            },
            {
              cle: "statut",
              entete: t("Contrôles", "Checks"),
              rendu: (e) => (
                <BadgeStatut tonalite={statutEtat(e.statut, langue).tonalite}>
                  {statutEtat(e.statut, langue).libelle}
                  {e.controles_ok ? "" : ` (${e.ecarts} ${t("écart(s)", "gap(s)")})`}
                </BadgeStatut>
              ),
            },
            {
              cle: "actif",
              entete: t("Total actif", "Total assets"),
              alignement: "droite",
              rendu: (e) => formaterMontantMineur(e.totaux.actif, e.devise, langue),
            },
            {
              cle: "resultat",
              entete: t("Résultat", "Result"),
              alignement: "droite",
              rendu: (e) => formaterMontantMineur(e.totaux.resultat, e.devise, langue),
            },
          ]}
        />
        {d.fiabilite.analyses_indicatives && etats.length > 0 ? (
          <p>
            {t(
              "Analyses indicatives : la fiabilité des données du client appelle la prudence.",
              "Indicative analyses: the reliability of the client's data calls for caution.",
            )}
          </p>
        ) : null}
      </Carte>
    </div>
  );
}
