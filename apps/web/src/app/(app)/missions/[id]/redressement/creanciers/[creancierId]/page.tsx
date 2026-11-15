import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { RedCreancierVue, RedCreanceVue } from "@missionpilot/shared";
import { EcheancierAccord } from "../../../../../../../components/redressement/EcheancierAccord";
import { EtatContexteRed } from "../../../../../../../components/redressement/EtatsContexte";
import { FilNegociation } from "../../../../../../../components/redressement/FilNegociation";
import {
  FormulaireCreance,
  FormulaireModificationCreancier,
} from "../../../../../../../components/redressement/FormulaireCreancier";
import {
  FormulaireEvenement,
  RompreAccord,
} from "../../../../../../../components/redressement/FormulaireEvenement";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import {
  formaterDate,
  formaterDateHeure,
  formaterMontantMineur,
} from "../../../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../../../lib/i18n/serveur";
import { estIdentifiant } from "../../../../../../../lib/identifiant";
import { aujourdhui as aujourdhuiIso } from "../../../../../../../lib/periode";
import {
  BANDEAU_CONFIDENTIALITE,
  BANDEAU_CONFIDENTIALITE_EN,
  cheminCreancier,
  hrefCreancierRed,
  hrefRedressement,
  libelleCategorieCreancier,
  libelleStatutAccord,
  raisonSansEcriture,
  tonaliteStatutAccord,
} from "../../../../../../../lib/redressement";
import { chargerContexteRed } from "../../../../../../../lib/redressement-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Créancier du redressement", "Turnaround creditor") };
}

/**
 * Fiche d'un créancier : créance courante et historique des versions, mise à jour de la créance,
 * fil de négociation, formulaire d'événement, accord en vigueur et son échéancier, rupture.
 * Situation, imputation et statut de l'accord : calculés par l'API à chaque lecture.
 */
export default async function PageCreancier({
  params,
}: {
  params: Promise<{ id: string; creancierId: string }>;
}) {
  const { id, creancierId } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  if (!estIdentifiant(creancierId)) notFound();
  const retour = hrefRedressement(id, "creanciers");
  const ctx = await chargerContexteRed(id);
  if (ctx.etat !== "ok") {
    return (
      <EtatContexteRed
        contexte={ctx}
        missionId={id}
        hrefReessayer={hrefCreancierRed(id, creancierId)}
      />
    );
  }
  const { mission, dossier, droits } = ctx;
  const r = await chargerServeur<RedCreancierVue>(cheminCreancier(creancierId));
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <EtatErreur
        titre={t("Le créancier n'a pas pu être chargé.", "The creditor could not be loaded.")}
        message={r.message}
        hrefReessayer={hrefCreancierRed(id, creancierId)}
      />
    );
  }
  const c = r.donnees;
  const devise = dossier.devise;
  const m = (v: number) => formaterMontantMineur(v, devise, langue);
  const jour = aujourdhuiIso();
  const accord = c.accord_en_vigueur;
  const restantes = c.situation.accord?.echeances_restantes ?? [];

  return (
    <div className="mp-red">
      <EnteteDePage
        titre={c.nom}
        retour={{ href: retour, libelle: t("Créanciers", "Creditors") }}
        soustitre={`${libelleCategorieCreancier(c.categorie, langue)}${c.garanti ? ` · ${t("créance garantie", "secured claim")}` : ""}${c.reference ? ` · ${t("réf.", "ref.")} ${c.reference}` : ""}`}
        badges={
          c.situation.accord ? (
            <BadgeStatut tonalite={tonaliteStatutAccord(c.situation.accord.statut)}>
              {t("Accord :", "Agreement:")} {libelleStatutAccord(c.situation.accord.statut, langue)}
            </BadgeStatut>
          ) : null
        }
      />
      <Alerte tonalite="info" annonce="aucune">
        <p>{t(BANDEAU_CONFIDENTIALITE, BANDEAU_CONFIDENTIALITE_EN)}</p>
      </Alerte>

      <div className="mp-red-cartes">
        <Carte titre={t("Encours restant", "Outstanding")} niveauTitre={3}>
          <p className="mp-red-chiffre mp-red-valeur">{m(c.situation.encours_restant)}</p>
          <p className="mp-texte-doux mp-texte-petit">
            {t("Encours initial :", "Initial outstanding:")} {m(c.situation.encours_initial)}
          </p>
        </Carte>
        <Carte titre={t("Dont échu", "Of which overdue")} niveauTitre={3}>
          <p className="mp-red-chiffre mp-red-valeur">{m(c.situation.echu)}</p>
        </Carte>
        <Carte titre={t("Créance courante", "Current claim")} niveauTitre={3}>
          <dl className="mp-liste-def">
            <div>
              <dt>Version</dt>
              <dd>{c.version_creance}</dd>
            </div>
            <div>
              <dt>{t("Principal", "Principal")}</dt>
              <dd className="mp-red-valeur">{m(c.principal)}</dd>
            </div>
            <div>
              <dt>{t("Intérêts et pénalités", "Interest and penalties")}</dt>
              <dd className="mp-red-valeur">{m(c.interets)}</dd>
            </div>
            <div>
              <dt>{t("Arrêtée au", "Cut off at")}</dt>
              <dd>{formaterDate(c.date_arrete, "UTC", langue)}</dd>
            </div>
            {c.echeance_initiale ? (
              <div>
                <dt>{t("Échéance initiale", "Initial due date")}</dt>
                <dd>{formaterDate(c.echeance_initiale, "UTC", langue)}</dd>
              </div>
            ) : null}
          </dl>
        </Carte>
      </div>

      {accord ? (
        <Carte titre={t("Accord en vigueur", "Agreement in force")}>
          <EcheancierAccord
            accord={accord}
            situation={c.situation}
            devise={devise}
            annulation={droits.ecrire ? { creancierId: c.id, aujourdhui: jour } : undefined}
          />
          {droits.ecrire ? (
            <RompreAccord creancierId={c.id} accordId={accord.id} aujourdhui={jour} />
          ) : null}
        </Carte>
      ) : null}

      <Carte titre={t("Fil de négociation", "Negotiation timeline")}>
        <FilNegociation evenements={c.evenements} devise={devise} />
      </Carte>

      {droits.ecrire ? (
        <>
          <Carte titre={t("Ajouter un événement", "Add an event")}>
            <FormulaireEvenement
              key={`${c.evenements.length}-${accord?.id ?? "aucun"}`}
              creancierId={c.id}
              devise={devise}
              aujourdhui={jour}
              accord={accord ? { id: accord.id, restantes } : null}
            />
          </Carte>
          <Carte titre={t("Mettre à jour la créance", "Update the claim")}>
            <FormulaireCreance
              key={c.version_creance}
              creancierId={c.id}
              devise={devise}
              courante={c}
            />
          </Carte>
          <Carte titre={t("Modifier le créancier", "Edit the creditor")}>
            <FormulaireModificationCreancier
              key={`${c.nom}-${c.actif}-${c.garanti}`}
              creancierId={c.id}
              nom={c.nom}
              reference={c.reference}
              garanti={c.garanti}
              actif={c.actif}
            />
          </Carte>
        </>
      ) : (
        <p className="mp-texte-doux">
          {raisonSansEcriture(mission, dossier, ctx.session.utilisateur.roles, langue)}
        </p>
      )}

      <Carte titre={t("Historique des versions de la créance", "Claim version history")}>
        <Tableau
          legende={t("Versions de la créance", "Claim versions")}
          colonnes={[
            {
              cle: "version",
              entete: t("Version", "Version"),
              rendu: (v: RedCreanceVue) => v.version,
            },
            {
              cle: "principal",
              entete: t("Principal", "Principal"),
              alignement: "droite",
              rendu: (v) => <span className="mp-red-valeur">{m(v.principal)}</span>,
            },
            {
              cle: "interets",
              entete: t("Intérêts", "Interest"),
              alignement: "droite",
              rendu: (v) => <span className="mp-red-valeur">{m(v.interets)}</span>,
            },
            {
              cle: "arrete",
              entete: t("Arrêtée au", "Cut off at"),
              rendu: (v) => formaterDate(v.date_arrete, "UTC", langue),
            },
            {
              cle: "auteur",
              entete: t("Saisie par", "Entered by"),
              rendu: (v) =>
                `${v.saisi_par.nom}, ${t("le", "on")} ${formaterDateHeure(v.cree_le, undefined, langue)}`,
            },
            {
              cle: "commentaire",
              entete: t("Commentaire", "Comment"),
              rendu: (v) => v.commentaire ?? "—",
            },
          ]}
          lignes={c.creances}
          cleLigne={(v) => v.id}
        />
      </Carte>
      <p>
        <Link href={retour}>
          {t("Revenir au registre des créanciers", "Back to the creditor register")}
        </Link>
      </p>
    </div>
  );
}
